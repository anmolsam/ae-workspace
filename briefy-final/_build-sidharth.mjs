import 'dotenv/config';
import { createBase, getRecords } from './src/lib/airtable.js';
import { buildBrief } from './src/briefy/briefBuilder.js';
const base = createBase(process.env.BRIEFY_AIRTABLE_BASE_ID);
const rows = await getRecords('Briefy', { filterByFormula: `AND({Deal Owner}="Sidharth S",{Brief Status}="Not Started")` }, base);
console.log('Sidharth Not-Started rows:', rows.length);
let n=0;
for (const r of rows.slice(0,12)) {
  try { await base('Briefy').update(r.id,{'Brief Status':'Generating'}); await buildBrief(r); n++; console.log('built', n, r.fields['Company Name']); }
  catch(e){ console.log('ERR', r.fields['Company Name'], e.message); }
}
console.log('DONE built', n);
