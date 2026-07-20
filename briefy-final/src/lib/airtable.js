import 'dotenv/config';
import Airtable from 'airtable';

/**
 * Create an Airtable base connection for any base id — used so Briefy can
 * connect to its own, completely separate base while ICP Match keeps using
 * its existing one by default (see the `base` singleton below).
 * @param {string} baseId
 */
export function createBase(baseId) {
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
}

const base = createBase(process.env.AIRTABLE_BASE_ID);

export const TABLES = {
  DEMO_SCHEDULED: 'Demo scheduled',
};

export async function getRecords(tableName, options = {}, targetBase = base) {
  const records = [];
  await targetBase(tableName).select(options).eachPage((page, next) => {
    records.push(...page);
    next();
  });
  return records;
}

export async function createRecord(tableName, fields, targetBase = base) {
  return targetBase(tableName).create(fields);
}

export async function updateRecord(tableName, recordId, fields, targetBase = base) {
  return targetBase(tableName).update(recordId, fields);
}

export default base;
