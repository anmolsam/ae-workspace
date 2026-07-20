/**
 * One-time (idempotent) setup: creates the "Briefy" table with the full field
 * schema from architecturefinal.md, inside Briefy's OWN Airtable base — if it
 * doesn't already exist. Never touches ICP Match's base or "ICP Match Final".
 *
 * Requires AIRTABLE_API_KEY with schema.bases:write scope AND access granted
 * to the Briefy base specifically (a token scoped only to ICP Match's base
 * will 403 here — that's the correct, safe failure mode).
 *
 * Usage: node scripts/setup-briefy-table.js
 */
import 'dotenv/config';

const BASE_ID = process.env.BRIEFY_AIRTABLE_BASE_ID;
const API_KEY = process.env.AIRTABLE_API_KEY;
const TABLE_NAME = process.env.BRIEFY_AIRTABLE_TABLE || 'Briefy';

const FIELDS = [
  // Seed fields — copied by syncFromIcpMatch.js from "ICP Match Final"
  { name: 'Deal ID', type: 'singleLineText' },
  { name: 'Deal Name', type: 'singleLineText' },
  { name: 'Company Name', type: 'singleLineText' },
  { name: 'Company Domain', type: 'singleLineText' },
  { name: 'IP State', type: 'singleLineText' },
  { name: 'IP Country', type: 'singleLineText' },
  { name: 'Meeting Date & Time', type: 'number', options: { precision: 0 } },
  { name: 'Exa Content', type: 'multilineText' },
  { name: 'Pages Scraped', type: 'multilineText' },
  { name: 'Trade Category', type: 'singleLineText' },
  {
    name: 'ICP Enriched At',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },
  { name: 'Deal Owner', type: 'singleLineText' },
  { name: 'Deal Stage', type: 'singleLineText' },
  { name: 'Deal Link', type: 'url' },

  // Engine-owned fields
  {
    name: 'Brief Status',
    type: 'singleSelect',
    options: {
      choices: [
        { name: 'Not Started' },
        { name: 'Generating' },
        { name: 'Ready' },
        { name: 'Error' },
        { name: 'Refreshing' },
      ],
    },
  },
  { name: 'Section Status', type: 'multilineText' },
  {
    name: 'Last Enriched At',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },

  // Research output fields — Briefy's own six sections
  { name: 'Company Overview', type: 'multilineText' },
  { name: 'Portfolio / Projects', type: 'multilineText' },
  { name: 'Org Tree', type: 'multilineText' },
  { name: 'ZoomInfo Revenue', type: 'singleLineText' },
  { name: 'Clay Revenue', type: 'singleLineText' },
  { name: 'Last Page Visited', type: 'singleLineText' },
  {
    name: 'Last Page Visited At',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },
  { name: 'Prior Deals', type: 'multilineText' },
  { name: 'Open Roles', type: 'multilineText' },
  { name: 'ZoomInfo Intent Score', type: 'singleLineText' },
];

async function main() {
  if (!BASE_ID || !API_KEY) {
    throw new Error('BRIEFY_AIRTABLE_BASE_ID and AIRTABLE_API_KEY must be set in .env');
  }

  const listRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!listRes.ok) {
    throw new Error(`Failed to list tables: ${listRes.status} ${await listRes.text()}`);
  }
  const { tables } = await listRes.json();

  if (tables.some(t => t.name === TABLE_NAME)) {
    console.log(`Table "${TABLE_NAME}" already exists — nothing to do.`);
    return;
  }

  const createRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: TABLE_NAME, fields: FIELDS }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create table: ${createRes.status} ${await createRes.text()}`);
  }

  console.log(`Table "${TABLE_NAME}" created with ${FIELDS.length} fields.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
