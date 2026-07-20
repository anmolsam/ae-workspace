import 'server-only';
import Airtable from 'airtable';

const TABLE = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

let base: Airtable.Base | null = null;

function getBase(): Airtable.Base {
  if (!base) {
    base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
      process.env.BRIEFY_AIRTABLE_BASE_ID as string
    );
  }
  return base;
}

export function getBriefyTable() {
  return getBase()(TABLE);
}

const MEETING_WINDOW_MS = 8 * 24 * 60 * 60 * 1000; // today through +7 days

/** Every meeting for one AE, today through the next 7 days, soonest first. */
export async function queryMeetingsForOwner(dealOwner: string) {
  const now = Date.now();
  const windowEnd = now - (now % (24 * 60 * 60 * 1000)) + MEETING_WINDOW_MS; // start of today + 8 days
  const startOfToday = now - (now % (24 * 60 * 60 * 1000));

  const safeDealOwner = dealOwner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const records: Airtable.Record<Airtable.FieldSet>[] = [];
  await getBriefyTable()
    .select({
      filterByFormula: `AND(
        {Deal Owner} = "${safeDealOwner}",
        {Meeting Date & Time} >= ${startOfToday},
        {Meeting Date & Time} < ${windowEnd}
      )`,
      sort: [{ field: 'Meeting Date & Time', direction: 'asc' }],
    })
    .eachPage((page, next) => {
      records.push(...page);
      next();
    });
  return records;
}

/** A single brief record, only if it belongs to the given AE — otherwise null (never leak existence). */
export async function getBriefRecordById(id: string, dealOwner: string) {
  const record = await getBriefyTable()
    .find(id)
    .catch((err: unknown) => {
      const airtableErr = err as { error?: string; statusCode?: number };
      if (airtableErr?.error === 'NOT_FOUND' || airtableErr?.statusCode === 404) {
        return null;
      }
      throw err;
    });
  if (!record || record.get('Deal Owner') !== dealOwner) return null;
  return record;
}

export async function setBriefStatusRefreshing(id: string, dealOwner: string) {
  const record = await getBriefRecordById(id, dealOwner);
  if (!record) return false;
  await getBriefyTable().update(id, { 'Brief Status': 'Refreshing' });
  return true;
}
