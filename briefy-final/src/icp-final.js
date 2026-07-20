/**
 * ICP Match Final — Full Pipeline
 *
 * Personal Email check: if domain is gmail/yahoo/hotmail/etc → flag + skip
 * Step 1: Exa — scrapes indexed pages (fast, clean text)
 * Step 2: Firecrawl — live direct scrape (catches sites not in Exa index)
 * Step 3: ZoomInfo — structured company data (industry/headcount/location)
 * Step 4: SerpAPI — Google organic + Knowledge Graph + Google Maps
 * Step 5: Not Found — if all four sources fail
 * Gemini 2.5 Pro classifies whichever context was found
 *
 * Usage:
 *   node src/icp-final.js              # process all unclassified records
 *   node src/icp-final.js --limit=10   # first N unclassified
 *   node src/icp-final.js --retry      # re-run only Exa no-content records (ZoomInfo/SerpAPI/Not Found)
 *   node src/icp-final.js --refetch    # re-run ZoomInfo + SerpAPI records with richer context
 *   node src/icp-final.js --rerun-all  # re-run every row that has a domain (full fresh pipeline)
 */
import 'dotenv/config';
import Airtable from 'airtable';
import { getRecords } from './lib/airtable.js';
import { enrichCompanyByDomain } from './lib/zoominfo.js';
import { exaScrape, firecrawlScrape, serpFallback } from './lib/scrapers.js';
import { chatCompletion, parseJsonResponse } from './lib/requesty.js';

const MODEL         = 'google/gemini-2.5-pro';
const TABLE         = 'ICP Match Final';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY QUALIFIER v2 — hardcoded keyword reference (Attentive AI / Data Ops)
// Contractor threshold: 2+ matches per trade
// ─────────────────────────────────────────────────────────────────────────────
const COMPANY_QUALIFIER = `
COMPANY QUALIFIER v2 — Keyword Reference for Trade-Level Classification
Attentive AI | Data Operations

CONTRACTOR TRADES (threshold: 2+ matches per trade)

Electrical
electrical contractor / contracting | electrician | electrical services / work / systems / construction
wiring | conduit | panelboard (with electri context) | circuit + install | high voltage | low voltage
power distribution | transformer | generator install | fire alarm + install/system/contract
security system + install | data cabling | fiber optic + install | lighting + install/contract/design
switchgear | electrical panel | NEC code | journeyman electrician | master electrician | IBEW

Mechanical / HVAC
mechanical contractor / contracting | HVAC | heating + ventilat / cool / air condition
air conditioning / conditioner | ductwork | duct install | chiller | boiler | rooftop unit | air handler
refrigeration / refrigerating | ventilation | sheet metal + contract/hvac/duct | piping + mechanical/hvac
testing and balancing | TAB + HVAC | thermostat | building automation | BAS | BMS | mechanical system
process piping | medical gas

Plumbing
plumbing | plumber | plumbing contractor / contracting | pipe fitting / fitter | drainage + install
sewer + install/repair/line | water heater / line / main / supply | backflow | gas piping / line / install
fixture + install/plumb | toilet + install | sanitary piping / system | storm drain / water / sewer
grease trap | water treatment | fire suppression | sprinkler + install/system/contract | fire protection

Concrete
concrete contractor / contracting | concrete work / services / construction / pour / placement | ready-mix
concrete pump | flatwork | slab on grade / pour / concrete | tilt-up | precast | post-tension | formwork
concrete form | concrete finish | stamped concrete | decorative concrete | curb + gutter/concrete
concrete repair | shotcrete | concrete cutting / cutter | core drill | concrete saw

Rebar
rebar | reinforcing steel | reinforcement + steel/bar/install/place | ironworker | post-tension + cable/strand/tendon
epoxy-coated + rebar | rebar + fabricat/install/plac/tie/detailing | dowel | welded wire mesh / fabric
structural reinforc | reinforcing bar

Structural Steel
structural steel | steel erection / erector / erecting | steel fabrication / fabricator / fabricating
miscellaneous metal | misc. metal | ornamental iron / metal / steel | steel joist | steel decking
welding / welder + steel/structural/certif | ironworker | AISC | AWS + certif/weld | steel connection
bolted connection | steel beam | steel column | heavy steel | light gauge steel
metal building + erect/system | pre-engineered metal/steel/building

Civil
civil contractor / contracting | civil engineer / construction / work / services | site development / developing
site preparation / prep | grading + contract/site/civil | drainage + system/install/civil
stormwater management / system | retaining wall | erosion control | sediment control | SWPPP
sewer + main/line/civil | water main | underground utility | trenching | pipe laying
subdivision + develop/infrastructure | infrastructure + contract/construct/develop
road construction / building / work | bridge + construct/contract/build

Utility
utility contractor / contracting | utility construction / install / services / work | underground utility
power line | transmission line | overhead line | telecom + contract/install/construct
fiber + optic/install/construct | gas main / line / distribution / pipeline
water main / distribution / line / pipeline | sewer main / line / construct | pipeline + contract/construct/install
electrical utility | substation | pole + install/set/replace | directional drill / bore / boring | HDD | trenching | trenchless

Earthwork
earthwork | excavation / excavating / excavator | grading | demolition | site clearing / prep
bulldozing / bulldozer | backfill | compaction | fill dirt | topsoil | cut and fill | trenching
hauling dirt/material/debris | dirt work | rock + blast/excavat/remov | shoring | dewatering
pile driving / driver | foundation + excavat/dig/drill | caisson | micro-pile | helical pier

General Contractor (GC)
general contractor / contracting | construction company / firm / group / management | GC | design-build
pre-construction | construction manager / management | CM at risk | CMAR | turnkey + construct
ground-up + construct | project delivery | owner's rep | self-perform | bonded and insured
licensed (general) contractor | commercial + general + contract | residential + general + contract

Roofing
roofing | roofer / roofs | roofing contractor / contracting | roof install / repair / replace / restore / system / membrane
TPO | EPDM | PVC + roof | built-up roof | BUR | single-ply | modified bit | shingle | standing seam
metal roof | flat roof | roof coating | roof deck | flashing | gutter + install/contract
waterproofing + roof | roofing and sheet metal

Flooring
flooring | floor contract / install / services | hardwood floor | laminate floor | vinyl + floor | LVT | LVP | VCT
carpet + install/contract/tile | tile + install/contract/floor/setter | ceramic tile | porcelain tile | terrazzo
epoxy floor | polished concrete + floor | floor polish | resilient floor | rubber floor | floor prep
self-leveling | floor coating

Finishing
finishing contract / work / carpenter / carpentry | interior finish | trim + install/carpenter/work | millwork
casework | cabinetry / cabinets + install/custom | countertop + install | door hardware + install
door + frame/hardware | specialty finish | acoustical ceiling / panel / tile | suspended ceiling | drop ceiling
ceiling grid | window treatment | architectural woodwork | finish hardware | restroom partition / accessories | toilet partition

Painting
painting | painter / painting + contractor / contracting | commercial paint | industrial paint
coating + contract/applic/industrial | wall covering | wallpaper | faux finish | epoxy coating
intumescent | fireproofing paint / coat / spray | blasting and paint / coat | sandblast | spray paint
painting + interior/exterior/commercial/residential | texturing wall / ceiling / paint

Drywall
drywall | gypsum board + install/contract | sheetrock | metal stud / framing | light gauge (metal) framing
tape and finish / bed / float / mud | joint compound | wall and ceiling + contract/install/system
interior wall / partition + system/install/contract | fire-rated wall / assembly / partition
demountable wall / partition | acoustical ceiling / treatment | FRP panel | shaft wall

Lumber & Framing
lumber | framing + contract/construct/crew/carpenter | wood framing | rough carpentry | framing carpenter
timber | engineered wood | truss | joist + wood/TJI/install | plywood | OSB | LVL | glulam | CLT
sheathing | subfloor | wood stud / frame / panel | stick-built / stick-frame | post and beam | heavy timber

Masonry
masonry | mason | brick + lay/work/contract/install/mason | block + lay/wall/CMU/mason | CMU
stone + mason/veneer/install/contract | concrete block | tuckpoint | grout + mason/block/CMU | mortar
cultural stone | manufactured stone | natural stone + install | stone veneer | thin brick
masonry + restor/repair/reinforce

Landscape & Irrigation
landscaping / landscape | irrigation | sprinkler + landscap/irrigation/lawn | lawn care / maint / service / install
sod + install | hydroseed | tree + plant/service/care/trim/remov | shrub | hardscape | softscape | outdoor living
retaining wall + landscap/garden | paver + install/patio | drip irrigation / system
landscape architect / design / construct / maintenance / contract | grounds maintenance | turf + install/manage/care

Paving
paving | asphalt | blacktop | concrete paving / pavement / paver | parking lot + pav/construct/repair/maint/strip
sealcoat | stripping / striping + parking | curb + gutter | sidewalk + install/repair/contract/pour
asphalt overlay / mill / pav / repair / patch / plant | chip seal | slurry seal | road pav / construct / surfac
pavement contract / mark / resurface / maint | concrete curb / sidewalk / flatwork

Specialty
specialty contractor / contracting | glazing | curtain wall | storefront + glass/install | window + install/contract/glazing
door + install/automatic/revolving/overhead | overhead door | garage door + install | fireproofing
insulation + contract/install/spray | spray foam | waterproofing | envelope + contract/consultant/system
exterior cladding | metal panel / wall / clad | ACM panel | signage + install/contract/fabricat
awning | canopy + install | fence + install/contract/erect | railing + install | elevator + install/contract/moderniz
escalator | conveyor / conveyance | demolition + contract/specialist/selective | abatement | asbestos
lead + abat/remov/paint | environmental + remedi/abat/contract

FMS (Facility Management Services)
facility / facilities management / manager | facility / facilities service / maint / operation | FM service
building manage / maint / operat | janitorial | custodial | commercial cleaning | MEP maintenance
preventive maintenance | work order + facility | CMMS | IFMA | integrated facility | property management
tenant service / improv / build-out | space management / planning

Snow Removal
snow removal / removing / remover | snow plowing | ice management / control / removal | de-icing / deicing
salting + snow/ice/parking/lot/road | winter service / maint / manage | snow manage / service / contract / haul
anti-icing | snow and ice

LC + LM (Landscape Construction & Management)
landscape construct / build + manage / maint | full-service landscape | landscape + construction/install + maint/manage
design-build + landscap | landscap + design-build

LC (Landscape Construction)
landscape construction / contractor / constructing | landscape installation / installer / installing
landscape builder / building | hardscape + construct/install/build | outdoor + construct/build + landscap/patio/deck
landscape develop / contract

LM (Landscape Management)
landscape management / manager | landscape maintenance | grounds management | grounds maintenance
lawn care / service / maint | turf management | property + landscap + maint
commercial landscape maint / service | landscape + enhance/refresh/seasonal
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER QUALIFIER — keyword reference for distributor / supply-house detection
// Supplier threshold: 3+ matches (higher bar to avoid false positives)
// ─────────────────────────────────────────────────────────────────────────────
const SUPPLIER_QUALIFIER = `
SUPPLIER SIGNALS (threshold: 3+ matches — any combination below)

distributor | distribution + company/center/network | wholesale / wholesaler | supply house
industrial supply / supplier | construction supply / supplier | building supply / materials
manufacturer / manufacturing (of construction materials/products) | fabricator (non-structural)
product catalog | product line | SKU | inventory | stock + product/item | in stock | order online
add to cart | shop online | online store (construction products) | e-commerce (construction)
bulk pricing / discount | quantity pricing | trade pricing | contractor pricing / discount
warehouse | fulfillment center | shipping + product/order | freight + product
HVAC supply | electrical supply | plumbing supply | roofing supply | concrete supply
lumber yard | building materials | fasteners | hardware + supply/store/distributor
pipe + supply/fitting/product | valve + supply/distributor | fitting + supply/distributor
duct + supply/product | insulation + supply/product | safety supply | tool + supply/distributor
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// EXCLUSION QUALIFIER — Non-ICP disqualifier signal reference
// Hard disqualifiers checked BEFORE positive ICP scoring
// ─────────────────────────────────────────────────────────────────────────────
const EXCLUSION_QUALIFIER = `
EXCLUSION SIGNALS — Non-ICP Disqualifiers
Check for these BEFORE positive ICP scoring. Hard disqualifiers override everything.

━━ HARD DISQUALIFIERS ━━

COMPANY TYPE MISMATCH — flag if company is clearly:
  Homeowner / individual consumer (not a business)
  Student, academic, or training inquiry
  Competitor: takeoff, estimating, or quantity survey software
    (PlanSwift, Bluebeam, Procore, eSub, Buildertrend, On-Screen Takeoff, Stack CT,
     ConEst, Trimble, Sage Estimating, Accubid, FastDUCT, FastPIPE, QuoteSoft,
     Countfire, Cubit, Buildxact, Groundplan, eTakeoff, Togal, Houzz, CoConstruct)
  Supplier / manufacturer / distributor with ZERO contracting operations
  Non-construction company (restaurant, retail, tech, healthcare, legal, finance, education)
  Software company (SaaS, app, platform, digital product)
  Recruitment, staffing, or HR company
  Government agency or public authority (not a private contractor)
  Freelance estimator or independent quantity surveyor (no field operations)
  Architecture-only or design-only firm (no construction arm)
  Engineering-only firm (no construction arm)
  Real estate investor or developer (no self-perform construction)
  Owner-builder (building for personal use only)

TRADE / WORK-TYPE EXCLUSIONS — flag if the company does ONLY:
  Irrigation only (no broader landscaping or site work)
  Swimming pools only
  Security systems / CCTV only (not part of broader electrical contracting)
  Low-voltage only (not part of broader electrical contracting)
  Fire alarm / fire suppression only (not part of broader MEP)
  Traffic control / flagging only
  Property management only (no construction work performed)
  Janitorial / cleaning only
  Restoration / remediation only (mold, water damage, fire damage — no new construction)
  Service / maintenance only (HVAC service calls, appliance repair — no project construction)
  Residential remodeling only (bathroom/kitchen remodel, handyman)
  Residential construction only (single-family homes, no commercial or mixed)
  Industrial-only HVAC or Plumbing — flag if the company primarily serves manufacturing plants,
    refineries, oil & gas, or industrial facilities with process piping, equipment maintenance,
    capital project installs, or production uptime services — even if they say "industrial AND
    commercial customers" (commercial here means business clients, NOT commercial building
    construction). Key signals: "process piping", "production equipment", "minimize downtime",
    "maximize uptime", "manufacturing facility", "industrial maintenance", "capital projects for
    industrial clients", "keeps facilities running". Only ICP if they clearly also do HVAC/plumbing
    installation in commercial buildings (offices, schools, hospitals, retail, multi-family).

BUSINESS VIABILITY EXCLUSIONS — flag if:
  Handyman or multi-trade small residential service business
  Solo operator / one-person shop with no commercial project volume evidence
  Clearly too small for estimating software (1-2 person operation, no crews)

LANGUAGE / GEOGRAPHY MISMATCH — flag if:
  Company operates exclusively in French (French plans, French workflows, Quebec-only)
  Company communicates exclusively in a non-English language
  No evidence of English-language operations possible

LEAD QUALITY EXCLUSIONS — flag if:
  Fake website, parked domain, or no real company presence
  Spam or invalid contact information
  Test / dummy / placeholder company name

NEED MISMATCH — flag if:
  Company clearly does not bid on projects or do pre-construction estimating
  Company does only service calls, maintenance, or warranty work
  No involvement in takeoffs, bid preparation, or project quantity measurement
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAL EMAIL DOMAINS — if company domain matches, flag as personal email
// ─────────────────────────────────────────────────────────────────────────────
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.ca','yahoo.com.au',
  'hotmail.com','hotmail.co.uk','hotmail.ca','outlook.com','live.com','msn.com',
  'icloud.com','me.com','mac.com','aol.com','mail.com','protonmail.com',
  'ymail.com','rocketmail.com','zoho.com','inbox.com','fastmail.com',
]);

function isPersonalEmail(domain) {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}


// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK 2 — ZoomInfo structured data (all available fields, rich context)
// ─────────────────────────────────────────────────────────────────────────────
async function zoomInfoFallback(domain) {
  try {
    const data = await enrichCompanyByDomain(domain);
    if (!data || (!data.industry && !data.country)) return null;

    const allIndustries = (data.industries || []).filter(Boolean);
    const location = [data.city, data.state, data.country].filter(Boolean).join(', ');

    const lines = [
      `=== ZOOMINFO: ${data.companyName || domain} ===`,
      `Source URL: https://www.zoominfo.com (GTM Enrich API)`,
      `Website: https://${domain}`,
      ``,
      `Company Name: ${data.companyName || domain}`,
      `Primary Industry: ${data.industry || '—'}`,
      allIndustries.length > 1 ? `All Industries: ${allIndustries.join(' | ')}` : '',
      `Headcount: ${data.headcount || '—'}`,
      `Revenue Range: ${data.revenue || '—'}`,
      `Location: ${location || '—'}`,
      `Ownership Type: ${data.ownershipType || '—'}`,
    ].filter(l => l !== '');

    const text = lines.join('\n');
    return { text, source: 'ZoomInfo' };
  } catch {
    return null;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// GEMINI 2.5 PRO — classify using scraped content + keyword reference
// ─────────────────────────────────────────────────────────────────────────────
async function classifyWithGemini(domain, companyName, exaContent) {
  const isZoomInfo = exaContent.source === 'ZoomInfo';
  const isSerpAPI  = exaContent.source === 'SerpAPI';
  const contentText = exaContent.text !== undefined ? exaContent.text : exaContent.combined;

  const sourceInstructions = isZoomInfo
    ? `DATA TYPE: Structured ZoomInfo data (not website text).
- Check industry/type fields directly for exclusion signals and ICP signals.
- If industry maps to a construction trade → ICP - Contractor (no keyword threshold needed).
- If industry is distributor/wholesaler/supply house → ICP - Supplier.
- If industry is vague ("Construction" alone) → Partial ICP.
- If industry clearly matches an exclusion category → apply Non-ICP.`
    : isSerpAPI
    ? `DATA TYPE: Google search data (organic results, Knowledge Graph, Google Maps).
- Business Type and Description from Knowledge Graph or Maps are strong signals.
- Check ALL sections: Knowledge Graph type/description, Maps type, organic snippets.
- Business Type directly indicating a construction trade → ICP - Contractor.
- Business Type indicating supplier/distributor → ICP - Supplier.
- Check for exclusion signals in business type, description, and organic snippets.`
    : `DATA TYPE: Website / scraped content.
- Read homepage, about, services, products, catalog pages carefully.
- Quote EXACT phrases for all evidence (both ICP signals and exclusion signals).
- Check EVERY contractor trade (2+ threshold) and all supplier signals (3+ threshold).`;

  const prompt = `You are an expert construction industry analyst classifying companies for Beam AI (ibeam.ai), an AI-powered takeoff and estimating platform for the construction trades.

COMPANY: ${companyName || domain}
DOMAIN: ${domain}

DATA SOURCE: ${exaContent.source}
CONTENT:
${contentText}

═══════════════════════════════════════════════════════════════
POSITIVE ICP REFERENCE — COMPANY QUALIFIER v2:
${COMPANY_QUALIFIER}

═══════════════════════════════════════════════════════════════
SUPPLIER QUALIFIER (threshold: 3+ matches):
${SUPPLIER_QUALIFIER}

═══════════════════════════════════════════════════════════════
EXCLUSION REFERENCE:
${EXCLUSION_QUALIFIER}

═══════════════════════════════════════════════════════════════
SOURCE INSTRUCTIONS:
${sourceInstructions}

═══════════════════════════════════════════════════════════════
CLASSIFICATION STEPS — follow in this exact order:

STEP 1 — HARD DISQUALIFIERS (check first, highest priority):
Scan for any clearly evidenced hard disqualifier from the EXCLUSION REFERENCE.
If a hard disqualifier is STRONGLY and CLEARLY present → assign the matching Non-ICP category immediately.
Examples: homeowner inquiry, competitor software, pure supplier with no contracting, residential-only builder, solo handyman.
⚠ Do NOT disqualify on weak or vague evidence — if uncertain, continue to Step 2.

STEP 2 — POSITIVE ICP CHECK (if no hard disqualifiers found):
- Check COMPANY QUALIFIER v2: 2+ keyword matches in any trade → ICP - Contractor
- Check SUPPLIER QUALIFIER: 3+ matches AND company serves construction → ICP - Supplier
- Both qualify → ICP - Both

STEP 3 — SOFT EXCLUSION CHECK (only if Step 2 found NO positive ICP signals):
If no ICP signals found, check for soft exclusions (trade-type, viability, language, need mismatch).
If clearly evidenced → assign the matching Non-ICP category.

STEP 4 — PARTIAL ICP:
Construction signals present but below threshold, OR mixed residential+commercial signals, OR ambiguous → Partial ICP.

═══════════════════════════════════════════════════════════════
CONSERVATIVE RULES (do not violate):
- NEVER disqualify on weak, vague, or single-word evidence.
- Company does both residential AND commercial → do NOT disqualify (not residential-only).
- Company does service/maintenance AND project construction → do NOT disqualify (not service-only).
- When in doubt between Non-ICP and Partial ICP → choose Partial ICP.
- DOMAIN IS SACRED: only classify the company at ${domain}.

═══════════════════════════════════════════════════════════════
OUTPUT — icpStatus must be EXACTLY one of these strings:
  "ICP - Contractor"                         → 2+ trade keyword matches
  "ICP - Supplier"                           → 3+ supplier signals, serves construction
  "ICP - Both"                               → qualifies as both
  "Partial ICP"                              → below threshold or mixed/ambiguous signals
  "Non-ICP - Company type mismatch"          → homeowner, competitor, non-construction, software, staffing, govt, architect-only, etc.
  "Non-ICP - Trade or work-type exclusions"  → irrigation-only, pools-only, residential-only, service-only, etc.
  "Non-ICP - Business viability exclusions"  → handyman, solo operator, too small
  "Non-ICP - Language or geography mismatch" → French-only, non-English-only
  "Non-ICP - Lead quality exclusions"        → fake, spam, parked domain, no company presence
  "Non-ICP - Need mismatch"                  → no bidding/estimating, service-call-only, no takeoff need

Return ONLY valid JSON, no markdown:
{
  "icpStatus": "...",
  "contractorFlag": true | false,
  "trades": ["Trade1", "Trade2"],
  "matchedKeywords": {
    "Trade1": ["exact phrase from content"],
    "Supplier": ["exact phrase"],
    "Exclusion": ["exact phrase or signal that triggered Non-ICP"]
  },
  "exclusionCategory": "Company type mismatch" | "Trade or work-type exclusions" | "Business viability exclusions" | "Language or geography mismatch" | "Lead quality exclusions" | "Need mismatch" | null,
  "reason": "2-3 sentence explanation citing specific evidence from the content"
}`;

  const raw = await chatCompletion({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1 });
  return parseJsonResponse(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const limitArg        = process.argv.find(a => a.startsWith('--limit='));
  const domainArg       = process.argv.find(a => a.startsWith('--domain='));
  const retryMode       = process.argv.includes('--retry');
  const refetchMode     = process.argv.includes('--refetch');
  const doublecheckMode = process.argv.includes('--doublecheck');
  const rerunAllMode    = process.argv.includes('--rerun-all');
  const limit           = limitArg ? parseInt(limitArg.split('=')[1]) : 999;
  const singleDomain    = domainArg ? domainArg.split('=')[1].replace(/^www\./, '') : null;

  const filterFormula = doublecheckMode
    ? `AND(OR({ICP Status} = "Not ICP", {ICP Status} = "Partial ICP", {ICP Status} = "Not Found", {ICP Status} = "Non-ICP - Company type mismatch", {ICP Status} = "Non-ICP - Trade or work-type exclusions", {ICP Status} = "Non-ICP - Business viability exclusions", {ICP Status} = "Non-ICP - Language or geography mismatch", {ICP Status} = "Non-ICP - Lead quality exclusions", {ICP Status} = "Non-ICP - Need mismatch"), {Personal Email} != TRUE())`
    : rerunAllMode
    // Re-run every row that has a domain — full fresh pipeline regardless of current ICP Status
    ? `AND({Company domain} != "", {Company domain} != "undefined", {Personal Email} != TRUE())`
    : singleDomain
    ? `OR({Company domain} = "${singleDomain}", {Company domain} = "www.${singleDomain}")`
    : retryMode
    ? `FIND("PAGES SCRAPED (0)", {Exa Content}) > 0`
    : refetchMode
    ? `OR({Data Source} = "ZoomInfo", {Data Source} = "SerpAPI", {Data Source} = "Not Found")`
    : `AND({Company domain} != "", {Company domain} != "undefined", {Exa Content} = "")`;

  const records = await getRecords(TABLE, { filterByFormula: filterFormula, maxRecords: limit });

  const modeLabel = doublecheckMode ? '[DOUBLECHECK] ' : rerunAllMode ? '[RERUN-ALL] ' : singleDomain ? `[DOMAIN: ${singleDomain}] ` : retryMode ? '[RETRY] ' : refetchMode ? '[REFETCH] ' : '';
  console.log(`${modeLabel}Processing ${records.length} records from "${TABLE}"\n`);
  console.log(`${'Company'.padEnd(35)} | ${'Source'.padEnd(10)} | ${'ICP Status'.padEnd(18)} | Trades`);
  console.log('─'.repeat(100));

  const NON_ICP = [
    'Non-ICP - Company type mismatch',
    'Non-ICP - Trade or work-type exclusions',
    'Non-ICP - Business viability exclusions',
    'Non-ICP - Language or geography mismatch',
    'Non-ICP - Lead quality exclusions',
    'Non-ICP - Need mismatch',
  ];
  const ICP_POSITIVE = ['ICP - Contractor', 'ICP - Supplier', 'ICP - Both'];
  const RANK = { 'Not Found': 0, ...Object.fromEntries(NON_ICP.map(s => [s, 0])), 'Not ICP': 0, 'Partial ICP': 1, 'ICP - Contractor': 2, 'ICP - Supplier': 2, 'ICP - Both': 3 };

  let counts = { 'ICP - Contractor': 0, 'ICP - Supplier': 0, 'ICP - Both': 0, 'Partial ICP': 0, ...Object.fromEntries(NON_ICP.map(s => [s, 0])), 'Not Found': 0, failed: 0 };

  for (const record of records) {
    const rawDomain   = (record.fields['Company domain'] || '').trim().replace(/^www\./, '');
    const domain      = rawDomain;
    const companyName = (record.fields['Company Name'] || record.fields['Deal Name'] || '').split(' - ')[0].trim();
    const location    = [record.fields['IP State'], record.fields['IP Country']].filter(Boolean).join(' ');

    if (!domain || domain === 'undefined') {
      console.log(`  ○ ${'(no domain)'.padEnd(33)} | skipped`);
      continue;
    }

    try {
      let context    = null;
      let exaContent = '';
      let pagesField = '';

      // ── Personal Email check ──────────────────────────────────────────────
      const personalEmail = isPersonalEmail(domain);
      if (personalEmail) {
        await base(TABLE).update(record.id, {
          'Personal Email': true,
          'ICP Status':    'Not ICP',
          'Fit Reason':    `Domain "${domain}" is a personal email provider — no real company website.`,
          'Data Source':   'Personal Email',
          'Enriched At':   new Date().toISOString(),
        }, { typecast: true });
        console.log(`  ✉ ${companyName.slice(0, 33).padEnd(33)} | Personal Email — ${domain}`);
        counts['Not ICP'] = (counts['Not ICP'] || 0) + 1;
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // ── Double-check mode: re-run ALL sources fresh, combine everything ──
      if (doublecheckMode) {
        const oldStatus = record.fields['ICP Status'] || '(blank)';
        console.log(`\n  → [${companyName.slice(0,30)}] re-running all sources...`);

        try {
          const sep = '\n\n' + '═'.repeat(60) + '\n\n';
          const contentSections = [];
          const pageSections    = [];
          const sourceLabels    = [];

          process.stdout.write('     Exa...');
          const dcExa = await exaScrape(domain, location);
          if (dcExa) {
            contentSections.push(`=== EXA (${dcExa.pageCount} pages scraped) ===\n\n${dcExa.combined}`);
            pageSections.push(dcExa.pagesList);
            sourceLabels.push(`Exa (${dcExa.pageCount}pg)`);
            process.stdout.write(` ${dcExa.pageCount} pages\n`);
          } else {
            process.stdout.write(` none\n`);
          }

          process.stdout.write('     Firecrawl...');
          const dcFc = await firecrawlScrape(domain);
          if (dcFc) {
            contentSections.push(`=== FIRECRAWL (${dcFc.pageCount} pages scraped) ===\n\n${dcFc.combined}`);
            pageSections.push(dcFc.pagesList);
            sourceLabels.push(`Firecrawl (${dcFc.pageCount}pg)`);
            process.stdout.write(` ${dcFc.pageCount} pages\n`);
          } else {
            process.stdout.write(` none\n`);
          }

          process.stdout.write('     ZoomInfo...');
          const dcZi = await zoomInfoFallback(domain);
          if (dcZi) {
            contentSections.push(`=== ZOOMINFO ===\n\n${dcZi.text}`);
            pageSections.push(`https://www.zoominfo.com (GTM API for ${domain})`);
            sourceLabels.push('ZoomInfo');
            process.stdout.write(` found\n`);
          } else {
            process.stdout.write(` none\n`);
          }

          process.stdout.write('     SerpAPI...');
          const dcSerp = await serpFallback(domain, companyName);
          if (dcSerp) {
            contentSections.push(`=== SERPAPI (Google + Maps) ===\n\n${dcSerp.text}`);
            pageSections.push(`https://serpapi.com (Google + Maps for "${companyName || domain}")`);
            sourceLabels.push('SerpAPI');
            process.stdout.write(` found\n`);
          } else {
            process.stdout.write(` none\n`);
          }

          if (!contentSections.length) {
            await base(TABLE).update(record.id, {
              'Exa Content':   `DOUBLE-CHECK: ALL SOURCES RE-RUN — NO DATA FOUND\nURL: https://${domain}\n\n[Exa, Firecrawl, ZoomInfo, and SerpAPI all returned nothing]`,
              'ICP Status':    'Not Found',
              'Fit Reason':    `Double-check re-ran all 4 sources — still no data found for ${domain}. Domain may be dead, login-gated, or fully unindexed.`,
              'Double Checked': true,
              'Enriched At':   new Date().toISOString(),
            }, { typecast: true });
            console.log(`  ? ${companyName.slice(0,33).padEnd(33)} | — | Not Found (confirmed empty)`);
            counts['Not Found'] = (counts['Not Found'] || 0) + 1;
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          const combinedHeader = `DOUBLE-CHECK — ALL SOURCES RE-RUN\nSources: ${sourceLabels.join(' + ')}\n${'═'.repeat(60)}\n\n`;
          const combinedText   = contentSections.join(sep);
          const fullExaContent = combinedHeader + combinedText;
          const fullPages      = pageSections.join('\n');

          process.stdout.write('     Gemini...');
          const dcGemini = await classifyWithGemini(domain, companyName, { text: combinedText, source: 'Multi-source' });
          process.stdout.write(` ${dcGemini.icpStatus}\n`);

          const rank = RANK;
          const finalResult = dcGemini;

          const changed  = finalResult.icpStatus !== oldStatus;
          const upgraded = (rank[finalResult.icpStatus] ?? -1) > (rank[oldStatus] ?? -1);

          const changeTag = upgraded
            ? `[UPGRADED by double-check: ${oldStatus} → ${finalResult.icpStatus}]`
            : changed
            ? `[CHANGED by double-check: ${oldStatus} → ${finalResult.icpStatus}]`
            : `[Double-checked ✓ — confirmed ${oldStatus}]`;

          const finalReason = `${changeTag}\nSources re-run: ${sourceLabels.join(' + ')}\nLocation: ${location || 'unknown'}\n\n${finalResult.reason}`;

          const tradesStr   = (finalResult.trades || []).join(', ');
          const keywordsStr = Object.entries(finalResult.matchedKeywords || {})
            .map(([t, kws]) => `${t}: ${kws.join(', ')}`).join('\n');

          const allSrcLabels = [dcExa && 'Exa', dcFc && 'Firecrawl', dcZi && 'ZoomInfo', dcSerp && 'SerpAPI'].filter(Boolean);
          const primarySource = allSrcLabels.join(' + ') || 'Not Found';

          await base(TABLE).update(record.id, {
            'Exa Content':      fullExaContent,
            'Pages Scraped':    fullPages,
            'ICP Status':       finalResult.icpStatus,
            'Trade Category':   tradesStr,
            'Contractor Flag':  finalResult.contractorFlag ? 'Yes' : 'No',
            'Matched Keywords': keywordsStr,
            'Fit Reason':       finalReason,
            'Data Source':      primarySource,
            'Double Checked':   true,
            'Enriched At':      new Date().toISOString(),
          }, { typecast: true });

          counts[finalResult.icpStatus] = (counts[finalResult.icpStatus] || 0) + 1;
          const icon = ICP_POSITIVE.includes(finalResult.icpStatus) ? '✓'
                     : finalResult.icpStatus === 'Partial ICP' ? '~' : '✗';
          const tag  = changed
            ? ` ${oldStatus} → ${finalResult.icpStatus}`
            : ` confirmed ${finalResult.icpStatus}`;
          console.log(`  ${icon} ${companyName.slice(0,33).padEnd(33)} | ${primarySource.padEnd(10)} | ${finalResult.icpStatus.padEnd(18)} | ${tradesStr}${tag}`);

        } catch (err) {
          console.error(`  ✗ ERROR ${domain}: ${err.message}`);
          counts.failed++;
        }

        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // ── Step 1: Exa multi-page scrape ────────────────────────────────────
      const sourcesList = [];
      const exa = await exaScrape(domain, location);
      if (exa) {
        context    = { text: exa.combined, source: 'Exa' };
        exaContent = `PAGES SCRAPED (${exa.pageCount})\n\n${exa.combined}`;
        pagesField = exa.pagesList;
        sourcesList.push('Exa');
      }

      // ── Step 2: Firecrawl — supplement thin Exa OR full fallback ─────────
      const exaThin = exa && (exa.pageCount < 2 || exa.combined.length < 2000);
      if (!context || exaThin) {
        const fc = await firecrawlScrape(domain);
        if (fc) {
          sourcesList.push('Firecrawl');
          if (context) {
            const mergedText = context.text + '\n\n' + '─'.repeat(60) + '\n\n' + fc.combined;
            const mergedPages = pagesField + '\n' + fc.pagesList;
            const mergedCount = exa.pageCount + fc.pageCount;
            context    = { text: mergedText, source: 'Exa' };
            exaContent = `PAGES SCRAPED (${mergedCount}) [Exa + Firecrawl supplement]\n\n${mergedText}`;
            pagesField = mergedPages;
          } else {
            context    = { text: fc.combined, source: 'Firecrawl' };
            exaContent = `DATA SOURCE: Firecrawl (live scrape — not in Exa index)\n\n${'─'.repeat(60)}\n\n${fc.combined}`;
            pagesField = fc.pagesList;
          }
        }
      }

      // ── Step 3: ZoomInfo fallback ─────────────────────────────────────────
      if (!context) {
        const zi = await zoomInfoFallback(domain);
        if (zi) {
          context    = { text: zi.text, source: 'ZoomInfo' };
          exaContent = `DATA SOURCE: ZoomInfo GTM Enrich API\nExa + Firecrawl: no content found for ${domain}\n\n${'─'.repeat(60)}\n\n${zi.text}`;
          pagesField = `https://www.zoominfo.com (enriched via GTM API for ${domain})`;
          sourcesList.push('ZoomInfo');
        }
      }

      // ── Step 4: SerpAPI fallback ──────────────────────────────────────────
      if (!context) {
        const serp = await serpFallback(domain, companyName);
        if (serp) {
          context    = { text: serp.text, source: 'SerpAPI' };
          exaContent = `DATA SOURCE: SerpAPI (Google Organic + Knowledge Graph + Google Maps)\nExa + Firecrawl + ZoomInfo: no data found\n\n${'─'.repeat(60)}\n\n${serp.text}`;
          pagesField = `https://serpapi.com (Google search + Maps for "${companyName || domain}")`;
          sourcesList.push('SerpAPI');
        }
      }

      // ── Step 5: Not Found ─────────────────────────────────────────────────
      if (!context) {
        await base(TABLE).update(record.id, {
          'Exa Content':   `PAGES SCRAPED (0)\nURL: https://${domain}\n\n[Not Found — Exa, Firecrawl, ZoomInfo, and SerpAPI all returned no data]`,
          'Pages Scraped': `https://${domain}`,
          'ICP Status':    'Not Found',
          'Fit Reason':    'No data found via Exa, Firecrawl, ZoomInfo, or SerpAPI — domain may be dead, login-gated, or unindexed.',
          'Data Source':   'Not Found',
          'Enriched At':   new Date().toISOString(),
        }, { typecast: true });
        console.log(`  ? ${companyName.slice(0, 33).padEnd(33)} | ${'—'.padEnd(10)} | Not Found`);
        counts['Not Found']++;
        await new Promise(r => setTimeout(r, 600));
        continue;
      }

      // ── Step 6: Gemini 2.5 Pro classification ────────────────────────────
      const result = await classifyWithGemini(domain, companyName, context);

      const tradesStr   = (result.trades || []).join(', ');
      const keywordsStr = Object.entries(result.matchedKeywords || {})
        .map(([trade, kws]) => `${trade}: ${kws.join(', ')}`)
        .join('\n');

      await base(TABLE).update(record.id, {
        'Exa Content':      exaContent,
        'Pages Scraped':    pagesField,
        'ICP Status':       result.icpStatus,
        'Trade Category':   tradesStr,
        'Contractor Flag':  result.contractorFlag ? 'Yes' : 'No',
        'Matched Keywords': keywordsStr,
        'Fit Reason':       result.reason,
        'Data Source':      sourcesList.join(' + ') || 'Not Found',
        'Personal Email':   false,
        'Double Checked':   false,
        'Enriched At':      new Date().toISOString(),
      }, { typecast: true });

      counts[result.icpStatus] = (counts[result.icpStatus] || 0) + 1;

      const icon = ICP_POSITIVE.includes(result.icpStatus) ? '✓' : result.icpStatus === 'Partial ICP' ? '~' : '✗';
      console.log(`${icon} ${companyName.slice(0, 33).padEnd(33)} | ${sourcesList.join('+').padEnd(10)} | ${result.icpStatus.padEnd(38)} | ${tradesStr}`);

      // ── Step 7: Auto-doublecheck on uncertain results ─────────────────────
      if (result.icpStatus === 'Partial ICP' || result.icpStatus === 'Not Found' || result.icpStatus.startsWith('Non-ICP')) {
        process.stdout.write(`  ↳ doublecheck: `);
        try {
          const dcSections = [];
          const dcLabels   = [];

          const dcExa = await exaScrape(domain, location);
          process.stdout.write(`Exa(${dcExa?.pageCount ?? 0})... `);
          if (dcExa) { dcSections.push(dcExa.combined); dcLabels.push('Exa'); }

          const dcFc = await firecrawlScrape(domain);
          process.stdout.write(`FC(${dcFc?.pageCount ?? 0})... `);
          if (dcFc) { dcSections.push(dcFc.combined); dcLabels.push('Firecrawl'); }

          const dcSerp = await serpFallback(domain, companyName, location);
          process.stdout.write(`SERP(${dcSerp ? 'found' : 'none'})... `);
          if (dcSerp) { dcSections.push(dcSerp.text); dcLabels.push('SerpAPI'); }

          if (dcSections.length > 0) {
            const combinedText = dcSections.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
            const dcResult = await classifyWithGemini(domain, companyName, { text: combinedText, source: 'Multi-source' });

            const dcRank    = RANK;
            const upgraded  = (dcRank[dcResult.icpStatus] ?? -1) > (dcRank[result.icpStatus] ?? -1);
            const changed   = dcResult.icpStatus !== result.icpStatus;
            const changeTag = upgraded ? `[UPGRADED: ${result.icpStatus} → ${dcResult.icpStatus}]`
                            : changed  ? `[CHANGED: ${result.icpStatus} → ${dcResult.icpStatus}]`
                            :            `[Double-checked ✓]`;

            const dcTradesStr   = (dcResult.trades || []).join(', ');
            const dcKeywordsStr = Object.entries(dcResult.matchedKeywords || {}).map(([t, kws]) => `${t}: ${kws.join(', ')}`).join('\n');

            await base(TABLE).update(record.id, {
              'ICP Status':       dcResult.icpStatus,
              'Trade Category':   dcTradesStr,
              'Contractor Flag':  dcResult.contractorFlag ? 'Yes' : 'No',
              'Matched Keywords': dcKeywordsStr,
              'Fit Reason':       `${changeTag}\nSources: ${dcLabels.join(' + ')}\nLocation: ${location || 'unknown'}\n\n${dcResult.reason}`,
              'Exa Content':      combinedText.slice(0, 100000),
              'Data Source':      dcLabels.join(' + '),
              'Double Checked':   true,
              'Enriched At':      new Date().toISOString(),
            }, { typecast: true });

            counts[result.icpStatus] = Math.max(0, (counts[result.icpStatus] || 0) - 1);
            counts[dcResult.icpStatus] = (counts[dcResult.icpStatus] || 0) + 1;

            const dcIcon = ICP_POSITIVE.includes(dcResult.icpStatus) ? '✓'
                         : dcResult.icpStatus === 'Partial ICP' ? '~' : '✗';
            const dcTag  = changed ? ` ${result.icpStatus} → ${dcResult.icpStatus}` : ` confirmed ${dcResult.icpStatus}`;
            process.stdout.write(`${dcIcon} ${dcResult.icpStatus}${dcTag}\n`);
          } else {
            process.stdout.write(`no new content\n`);
          }
        } catch (dcErr) {
          process.stdout.write(`error: ${dcErr.message}\n`);
        }
        await new Promise(r => setTimeout(r, 600));
      }

    } catch (err) {
      console.error(`✗ ERROR ${domain}: ${err.message}`);
      counts.failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n' + '═'.repeat(100));
  Object.entries(counts).forEach(([k, v]) => v > 0 && console.log(`  ${k.padEnd(22)} ${v}`));
}

main().catch(console.error);
