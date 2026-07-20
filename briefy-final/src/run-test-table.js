/**
 * ICP Match — Test Table Runner
 * Reads from "ICP Match Test - Prashant", discovers missing domains,
 * runs the full pipeline (Exa → Firecrawl → ZoomInfo → SerpAPI → Gemini),
 * writes all results back.
 */
import 'dotenv/config';
import Airtable from 'airtable';

const EXA_API_KEY  = process.env.EXA_API_KEY;
const REQUESTY_KEY = process.env.REQUESTY_API_KEY;
const SERPAPI_KEY  = process.env.SERPAPI_KEY;
const MODEL        = 'google/gemini-2.5-pro';
const TABLE        = 'ICP Match Test - Prashant';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ── re-use classifier + scrapers from icp-final ──────────────────────────────
// (inline copies so we don't need to refactor imports)

import { enrichCompanyByDomain } from './lib/zoominfo.js';

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY QUALIFIER v2
// ─────────────────────────────────────────────────────────────────────────────
const COMPANY_QUALIFIER = `
COMPANY QUALIFIER v2 — Keyword Reference for Trade-Level Classification

CONTRACTOR TRADES (threshold: 2+ matches per trade)

Electrical
electrical contractor / contracting | electrician | electrical services / work / systems / construction
wiring | conduit | circuit + install | high voltage | low voltage | power distribution | transformer
generator install | fire alarm + install/system/contract | security system + install | data cabling
fiber optic + install | lighting + install/contract/design | switchgear | electrical panel | NEC code
journeyman electrician | master electrician | IBEW

Mechanical / HVAC
mechanical contractor / contracting | HVAC | heating + ventilat / cool / air condition
air conditioning / conditioner | ductwork | duct install | chiller | boiler | rooftop unit | air handler
refrigeration | ventilation | sheet metal + contract/hvac/duct | piping + mechanical/hvac
testing and balancing | TAB + HVAC | thermostat | building automation | BAS | BMS | mechanical system
process piping | medical gas

Plumbing
plumbing | plumber | plumbing contractor / contracting | pipe fitting / fitter | drainage + install
sewer + install/repair/line | water heater / line / main | backflow | gas piping / line / install
fixture + install/plumb | toilet + install | sanitary piping | storm drain | grease trap
water treatment | fire suppression | sprinkler + install/system/contract | fire protection

Concrete
concrete contractor / contracting | concrete work / services / construction / pour | ready-mix
concrete pump | flatwork | slab on grade | tilt-up | precast | post-tension | formwork | concrete form
concrete finish | stamped concrete | decorative concrete | curb + gutter/concrete | concrete repair
shotcrete | concrete cutting | core drill | concrete saw

Rebar
rebar | reinforcing steel | reinforcement + steel/bar/install/place | ironworker | post-tension + cable
epoxy-coated + rebar | rebar + fabricat/install/plac/tie/detailing | dowel | welded wire mesh
structural reinforc | reinforcing bar

Structural Steel
structural steel | steel erection / erector | steel fabrication / fabricator | miscellaneous metal
ornamental iron / metal / steel | steel joist | steel decking | welding / welder + steel/structural
ironworker | AISC | AWS + certif/weld | steel beam | steel column | pre-engineered metal/steel/building

Civil
civil contractor / contracting | civil engineer / construction | site development | site preparation
grading + contract/site/civil | drainage + system/install/civil | stormwater management | retaining wall
erosion control | SWPPP | sewer + main/line/civil | water main | underground utility | trenching
road construction | bridge + construct/contract

Utility
utility contractor / contracting | utility construction / install | underground utility | power line
transmission line | overhead line | telecom + contract/install | fiber + optic/install/construct
gas main / line / distribution | water main / distribution | sewer main / construct
pipeline + contract/construct/install | substation | directional drill | HDD | trenchless

Earthwork
earthwork | excavation / excavating / excavator | grading | demolition | site clearing
bulldozing / bulldozer | backfill | compaction | fill dirt | topsoil | cut and fill | trenching
hauling dirt/material | dirt work | rock + blast/excavat | shoring | dewatering
pile driving | foundation + excavat/dig/drill | caisson | micro-pile | helical pier

General Contractor (GC)
general contractor / contracting | construction company / firm / group / management | GC | design-build
pre-construction | construction manager / management | CM at risk | CMAR | turnkey + construct
ground-up + construct | self-perform | bonded and insured | licensed (general) contractor
commercial + general + contract | residential + general + contract

Roofing
roofing | roofer / roofs | roofing contractor / contracting | roof install / repair / replace / restore
TPO | EPDM | PVC + roof | built-up roof | single-ply | modified bit | shingle | standing seam
metal roof | flat roof | roof coating | roof deck | flashing | gutter + install/contract | waterproofing + roof

Flooring
flooring | floor contract / install | hardwood floor | laminate floor | vinyl + floor | LVT | LVP | VCT
carpet + install/contract/tile | tile + install/contract/floor/setter | ceramic tile | porcelain tile
epoxy floor | polished concrete | floor polish | resilient floor | rubber floor | floor coating

Finishing
finishing contract / work / carpentry | interior finish | trim + install | millwork | casework
cabinetry + install/custom | countertop + install | door + frame/hardware | specialty finish
acoustical ceiling / panel / tile | suspended ceiling | drop ceiling | ceiling grid | toilet partition

Painting
painting | painter / painting + contractor | commercial paint | industrial paint
coating + contract/applic/industrial | wall covering | wallpaper | epoxy coating | intumescent
fireproofing paint / coat / spray | sandblast | spray paint | painting + interior/exterior/commercial

Drywall
drywall | gypsum board + install | sheetrock | metal stud / framing | light gauge framing
tape and finish / bed / float / mud | joint compound | wall and ceiling + contract/install
interior wall / partition + system | fire-rated wall | demountable wall | acoustical ceiling | FRP panel

Lumber & Framing
lumber | framing + contract/construct/crew | wood framing | rough carpentry | framing carpenter
timber | engineered wood | truss | joist + wood/TJI | plywood | OSB | LVL | glulam | CLT
sheathing | subfloor | wood stud / frame | stick-built / stick-frame | post and beam | heavy timber

Masonry
masonry | mason | brick + lay/work/contract/install | block + lay/wall/CMU | CMU
stone + mason/veneer/install | concrete block | tuckpoint | grout + mason/block | mortar
cultural stone | manufactured stone | natural stone + install | stone veneer | thin brick

Landscape & Irrigation
landscaping / landscape | irrigation | sprinkler + landscap/irrigation | lawn care / maint / service
sod + install | hydroseed | tree + plant/service/care/trim | shrub | hardscape | softscape
retaining wall + landscap | paver + install/patio | drip irrigation | landscape architect / design
grounds maintenance | turf + install/manage

Paving
paving | asphalt | blacktop | concrete paving | parking lot + pav/construct/repair/maint
sealcoat | stripping / striping + parking | curb + gutter | sidewalk + install/repair/contract
asphalt overlay / mill / pav / repair | chip seal | slurry seal | road pav | pavement contract

Specialty
specialty contractor | glazing | curtain wall | storefront + glass | window + install/contract/glazing
overhead door | garage door + install | fireproofing | insulation + contract/install/spray | spray foam
waterproofing | metal panel / wall / clad | ACM panel | signage + install/contract | fence + install
railing + install | elevator + install | demolition + contract | abatement | asbestos | environmental + remedi

FMS (Facility Management Services)
facility / facilities management | facility service / maint / operation | janitorial | custodial
commercial cleaning | MEP maintenance | preventive maintenance | CMMS | IFMA | integrated facility
property management | tenant service | space management

Snow Removal
snow removal / removing | snow plowing | ice management / control | de-icing / deicing
salting + snow/ice/parking | winter service / maint | anti-icing | snow and ice
`.trim();

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

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com','yahoo.com','hotmail.com','outlook.com','live.com','msn.com',
  'icloud.com','me.com','mac.com','aol.com','mail.com','protonmail.com',
]);

function isPersonalEmail(domain) {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN DISCOVERY — find domain from company name + location via SerpAPI
// ─────────────────────────────────────────────────────────────────────────────
async function discoverDomain(companyName, location = '') {
  const locationHint = location ? ` ${location}` : '';
  const q = encodeURIComponent(`"${companyName}"${locationHint} official website`);
  const url = `https://serpapi.com/search.json?engine=google&q=${q}&num=5&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const organic = data.organic_results || [];
  // Return domain of first organic result that isn't a social/directory site
  const skip = /facebook|linkedin|yelp|bbb\.org|yellowpages|manta|dnb\.com|bloomberg|indeed|glassdoor/i;
  for (const r of organic) {
    try {
      const d = new URL(r.link).hostname.replace(/^www\./, '');
      if (!skip.test(d)) return d;
    } catch {}
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXA
// ─────────────────────────────────────────────────────────────────────────────
async function exaScrape(domain, location = '') {
  const baseUrl = `https://${domain}`;
  const wwwUrl  = `https://www.${domain}`;
  const directUrls = [
    baseUrl, wwwUrl,
    `${baseUrl}/about`, `${wwwUrl}/about`, `${baseUrl}/about-us`, `${wwwUrl}/about-us`,
    `${baseUrl}/services`, `${wwwUrl}/services`, `${baseUrl}/service`,
    `${baseUrl}/products`, `${baseUrl}/product`, `${baseUrl}/projects`,
    `${baseUrl}/what-we-do`, `${baseUrl}/our-work`, `${baseUrl}/work`,
    `${baseUrl}/trades`, `${baseUrl}/specialties`,
  ];
  const directRes = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: directUrls, text: { maxCharacters: 3000 } }),
  });
  const directData = directRes.ok ? await directRes.json() : { results: [] };
  const directPages = (directData.results || []).filter(r => r.text?.trim().length > 100);

  const searchRes = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `${domain}${location ? ' ' + location : ''} services products about contractor supplier`,
      type: 'keyword',
      includeDomains: [domain],
      numResults: 8,
      contents: { text: { maxCharacters: 3000 } },
    }),
  });
  const searchData = searchRes.ok ? await searchRes.json() : { results: [] };
  const searchPages = (searchData.results || []).filter(r => r.text?.trim().length > 100);

  const seen = new Set();
  const allPages = [...directPages, ...searchPages].filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // External fallback — if no domain pages found, search open web (finds BBB, LinkedIn, Yelp, directories)
  if (!allPages.length) {
    const extRes = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `"${domain}" OR site:${domain} construction contractor services what they do`,
        type: 'keyword',
        numResults: 5,
        contents: { text: { maxCharacters: 2000 } },
      }),
    });
    const extData = extRes.ok ? await extRes.json() : { results: [] };
    const extPages = (extData.results || []).filter(r => r.text?.trim().length > 100);
    if (extPages.length) allPages.push(...extPages);
  }

  if (allPages.length === 0) return null;
  const combined = allPages.map(r => `=== PAGE: ${r.title || r.url} ===\nURL: ${r.url}\n\n${r.text.trim()}`).join('\n\n' + '─'.repeat(60) + '\n\n');
  const pages    = allPages.map(r => r.url).join('\n');
  return { text: combined, source: 'Exa', pages, pageCount: allPages.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRECRAWL
// ─────────────────────────────────────────────────────────────────────────────
async function firecrawlScrape(domain) {
  const baseUrl = `https://${domain}`;
  const urls = [baseUrl, `${baseUrl}/about-us`, `${baseUrl}/about`, `${baseUrl}/services`, `${baseUrl}/what-we-do`];
  const results = [];
  for (const url of urls) {
    try {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 15000 }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.data?.markdown;
      if (text && text.trim().length > 150) results.push({ url, text: text.slice(0, 4000) });
    } catch { continue; }
    await new Promise(r => setTimeout(r, 500));
  }
  if (results.length === 0) return null;
  const combined = results.map(r => `=== PAGE: ${r.url} ===\nURL: ${r.url}\n\n${r.text.trim()}`).join('\n\n' + '─'.repeat(60) + '\n\n');
  const pages = results.map(r => r.url).join('\n');
  return { text: combined, source: 'Firecrawl', pages, pageCount: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// ZOOMINFO
// ─────────────────────────────────────────────────────────────────────────────
async function zoomInfoFallback(domain) {
  try {
    const data = await enrichCompanyByDomain(domain);
    if (!data) return null;
    const text = Object.entries(data).map(([k,v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n');
    return { text, source: 'ZoomInfo', pages: '', pageCount: 0 };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERPAPI
// ─────────────────────────────────────────────────────────────────────────────
async function serpFallback(domain, companyName, location = '') {
  const name = (companyName && companyName !== 'unknown' ? companyName : domain).split(' - ')[0].trim();
  const locationHint = location ? ` ${location}` : '';
  const sections = [];

  try {
    // Query 1: Google organic + Knowledge Graph + local pack
    const q1 = encodeURIComponent(`"${name}" ${domain}${locationHint}`);
    const res1 = await fetch(`https://serpapi.com/search.json?q=${q1}&num=5&api_key=${SERPAPI_KEY}`);
    if (res1.ok) {
      const d1 = await res1.json();

      if (d1.knowledge_graph) {
        const kg = d1.knowledge_graph;
        const kgLines = [
          `=== GOOGLE KNOWLEDGE GRAPH: ${kg.title || name} ===`,
          kg.type        ? `Business Type: ${kg.type}` : '',
          kg.description ? `Description: ${kg.description}` : '',
          kg.address     ? `Address: ${kg.address}` : '',
          kg.phone       ? `Phone: ${kg.phone}` : '',
          kg.website     ? `Website: ${kg.website}` : '',
          kg.rating      ? `Rating: ${kg.rating} (${kg.reviews} reviews)` : '',
        ].filter(Boolean);
        sections.push(kgLines.join('\n'));
      }

      const localPack = (d1.local_results?.places || d1.local_results || []).slice(0, 3);
      if (localPack.length) {
        const lpLines = [`=== GOOGLE MAPS LOCAL RESULTS ===`];
        localPack.forEach(p => {
          lpLines.push(
            `\n[${p.title || p.name}]`,
            p.type        ? `Type: ${p.type}` : '',
            p.address     ? `Address: ${p.address}` : '',
            p.description ? `Description: ${p.description}` : '',
            p.snippet     ? `Snippet: ${p.snippet}` : '',
            p.rating      ? `Rating: ${p.rating}` : '',
          );
        });
        sections.push(lpLines.filter(Boolean).join('\n'));
      }

      const organic = (d1.organic_results || []).slice(0, 5);
      if (organic.length) {
        const orgLines = [`=== GOOGLE ORGANIC RESULTS ===`];
        organic.forEach(r => { orgLines.push(`\n[${r.link}]\n${r.title}\n${r.snippet || ''}`); });
        sections.push(orgLines.join('\n'));
      }
    }

    // Query 2: Google Maps direct search
    const q2 = encodeURIComponent(`${name} ${domain}${locationHint}`);
    const res2 = await fetch(`https://serpapi.com/search.json?engine=google_maps&q=${q2}&api_key=${SERPAPI_KEY}`);
    if (res2.ok) {
      const d2 = await res2.json();
      const places = (d2.local_results || []).slice(0, 3);
      if (places.length) {
        const mapLines = [`=== GOOGLE MAPS SEARCH: ${name} ===`];
        places.forEach(p => {
          mapLines.push(
            `\n[${p.title}]`,
            p.type        ? `Type: ${p.type}` : '',
            p.address     ? `Address: ${p.address}` : '',
            p.description ? `Description: ${p.description}` : '',
            p.website     ? `Website: ${p.website}` : '',
            p.phone       ? `Phone: ${p.phone}` : '',
            p.rating      ? `Rating: ${p.rating} (${p.reviews} reviews)` : '',
          );
        });
        sections.push(mapLines.filter(Boolean).join('\n'));
      }
    }

    if (!sections.length) return null;
    const header = `⚠️  DOMAIN MATCH WARNING: All results below must relate to "${domain}". If a result shows a DIFFERENT company that merely shares the name, IGNORE it entirely.\nOnly classify based on results that clearly belong to ${domain}.\n\n${'─'.repeat(60)}\n\n`;
    return { text: header + sections.join('\n\n' + '─'.repeat(60) + '\n\n'), source: 'SerpAPI', pages: '', pageCount: 0 };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────
async function classifyWithGemini(domain, companyName, exaContent) {
  const isZoomInfo = exaContent.source === 'ZoomInfo';
  const isSerpAPI  = exaContent.source === 'SerpAPI';
  const contentText = exaContent.text;

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
⚠ Do NOT disqualify on weak or vague evidence — if uncertain, continue to Step 2.

STEP 2 — POSITIVE ICP CHECK (if no hard disqualifiers found):
- Check COMPANY QUALIFIER v2: 2+ keyword matches in any trade → ICP - Contractor
- Check SUPPLIER QUALIFIER: 3+ matches AND company serves construction → ICP - Supplier
- Both qualify → ICP - Both

STEP 3 — SOFT EXCLUSION CHECK (only if Step 2 found NO positive ICP signals):
If no ICP signals found, check for soft exclusions (trade-type, viability, language, need mismatch).
If clearly evidenced → assign the matching Non-ICP category.

STEP 4 — PARTIAL ICP:
Construction signals present but below threshold, OR mixed signals, OR ambiguous → Partial ICP.

═══════════════════════════════════════════════════════════════
CONSERVATIVE RULES:
- NEVER disqualify on weak, vague, or single-word evidence.
- Company does both residential AND commercial → do NOT disqualify (not residential-only).
- Company does service/maintenance AND project construction → do NOT disqualify (not service-only).
- When in doubt between Non-ICP and Partial ICP → choose Partial ICP.
- DOMAIN IS SACRED: only classify the company at ${domain}.

OUTPUT — icpStatus must be EXACTLY one of these strings:
  "ICP - Contractor"
  "ICP - Supplier"
  "ICP - Both"
  "Partial ICP"
  "Non-ICP - Company type mismatch"
  "Non-ICP - Trade or work-type exclusions"
  "Non-ICP - Business viability exclusions"
  "Non-ICP - Language or geography mismatch"
  "Non-ICP - Lead quality exclusions"
  "Non-ICP - Need mismatch"

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
  "reason": "2-3 sentence explanation citing specific evidence"
}`;

  const res = await fetch('https://router.requesty.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${REQUESTY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1 }),
  });
  if (!res.ok) throw new Error(`Requesty ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || '').replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${raw.slice(0,200)}`);
  return JSON.parse(match[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const records = await base(TABLE).select({ maxRecords: 50 }).all();
  console.log(`Processing ${records.length} records from "${TABLE}"\n`);
  console.log(`${'#'.padEnd(3)} ${'Company'.padEnd(35)} | ${'Domain'.padEnd(28)} | ${'Status'.padEnd(18)} | Trades`);
  console.log('─'.repeat(110));

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
  const needsDoublecheck = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const f = record.fields;
    const companyName = (f['Company Name'] || f['Deal Name'] || '').split(' - ')[0].trim();
    const location    = [f['IP State'], f['IP Country']].filter(Boolean).join(' ');

    // Extract domain from Company Domain field or embedded in name
    let domain = (f['Company Domain'] || '').trim().replace(/^www\./, '').replace(/\s.*$/, '');
    if (!domain) {
      // Check if domain is embedded in Deal Name / Company Name like "foo.com - Name"
      const embedded = (f['Deal Name'] || f['Company Name'] || '').match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
      if (embedded && !['Inc', 'LLC', 'Ltd', 'Corp'].includes(embedded[1])) {
        domain = embedded[1].toLowerCase();
      }
    }

    process.stdout.write(`  ${String(i+1).padEnd(2)} ${companyName.slice(0,33).padEnd(33)} | ${(domain || '?').padEnd(28)} | `);

    try {
      // Personal email check
      if (domain && isPersonalEmail(domain)) {
        await base(TABLE).update(record.id, {
          'ICP Status': 'Not ICP', 'Personal Email': true,
          'Fit Reason': `Domain "${domain}" is a personal email provider.`,
          'Data Source': 'Personal Email', 'Enriched At': new Date().toISOString(),
        });
        process.stdout.write(`Not ICP             | Personal email\n`);
        counts['Not ICP']++;
        continue;
      }

      // Domain discovery if still missing
      if (!domain) {
        process.stdout.write(`[discovering domain] `);
        domain = await discoverDomain(companyName, location);
        if (domain) {
          await base(TABLE).update(record.id, { 'Company Domain': domain });
          process.stdout.write(`→ ${domain} `);
        }
      }

      if (!domain) {
        await base(TABLE).update(record.id, {
          'ICP Status': 'Not Found', 'Fit Reason': 'Could not discover a domain for this company.',
          'Data Source': 'Not Found', 'Enriched At': new Date().toISOString(),
        });
        process.stdout.write(`Not Found           | No domain discovered\n`);
        counts['Not Found']++;
        continue;
      }

      // ── Phase 1: Data Collection ──────────────────────────────────────────
      let context     = null;
      let exaContent  = '';
      let pagesField  = '';
      let primarySource = 'Not Found';

      // Exa
      const exa = await exaScrape(domain, location);
      if (exa) {
        process.stdout.write(`Exa(${exa.pageCount})... `);
        exaContent = exa.text;
        pagesField = exa.pages;
        primarySource = 'Exa';
        context = exa;
      }

      // Firecrawl supplements if Exa thin
      if (!context || context.pageCount < 2 || context.text.length < 2000) {
        const fc = await firecrawlScrape(domain);
        if (fc) {
          process.stdout.write(`FC(${fc.pageCount})... `);
          if (!context) {
            context = fc;
            primarySource = 'Firecrawl';
          } else {
            context = { ...context, text: context.text + '\n\n[Exa + Firecrawl supplement]\n\n' + fc.text };
          }
          exaContent = context.text;
          pagesField = [pagesField, fc.pages].filter(Boolean).join('\n');
        }
      }

      // ZoomInfo — fallback only if no content yet
      if (!context) {
        const zi = await zoomInfoFallback(domain);
        if (zi) {
          process.stdout.write(`ZI... `);
          context = zi; primarySource = 'ZoomInfo'; exaContent = zi.text;
        }
      }

      // SerpAPI — fallback only if still no content
      if (!context) {
        const serp = await serpFallback(domain, companyName, location);
        if (serp) {
          process.stdout.write(`SERP... `);
          context = serp; primarySource = 'SerpAPI'; exaContent = serp.text;
        }
      }

      if (!context) {
        await base(TABLE).update(record.id, {
          'ICP Status': 'Not Found', 'Fit Reason': `No content found for ${domain} across Exa, Firecrawl, ZoomInfo, SerpAPI.`,
          'Data Source': 'Not Found', 'Enriched At': new Date().toISOString(),
        });
        process.stdout.write(`Not Found\n`);
        counts['Not Found']++;
        needsDoublecheck.push({ record, domain, companyName, location, oldStatus: 'Not Found' });
        continue;
      }

      // ── Phase 2: Gemini Classification ───────────────────────────────────
      const result = await classifyWithGemini(domain, companyName, context);

      const tradesStr   = (result.trades || []).join(', ');
      const keywordsStr = Object.entries(result.matchedKeywords || {})
        .map(([t, kws]) => `${t}: ${kws.join(', ')}`).join('\n');

      await base(TABLE).update(record.id, {
        'Company Domain':   domain,
        'ICP Status':       result.icpStatus,
        'Trade Category':   tradesStr,
        'Contractor Flag':  result.contractorFlag ? 'Yes' : 'No',
        'Matched Keywords': keywordsStr,
        'Fit Reason':       result.reason,
        'Exa Content':      exaContent.slice(0, 100000),
        'Pages Scraped':    pagesField,
        'Data Source':      primarySource,
        'Enriched At':      new Date().toISOString(),
      });

      counts[result.icpStatus] = (counts[result.icpStatus] || 0) + 1;
      const icon = ICP_POSITIVE.includes(result.icpStatus) ? '✓'
                 : result.icpStatus === 'Partial ICP' ? '~' : '✗';
      process.stdout.write(`${icon} ${result.icpStatus.padEnd(38)} | ${tradesStr}\n`);

      // Track uncertain records for auto-doublecheck
      if (result.icpStatus === 'Partial ICP' || result.icpStatus === 'Not Found' || result.icpStatus.startsWith('Non-ICP')) {
        needsDoublecheck.push({ record, domain, companyName, location, oldStatus: result.icpStatus });
      }

    } catch (err) {
      console.error(`\n  ✗ ERROR ${companyName}: ${err.message}`);
      counts.failed++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  // ── Auto-Doublecheck Phase: re-run ALL sources on uncertain records ─────────
  if (needsDoublecheck.length > 0) {
    console.log(`\n${'─'.repeat(110)}`);
    console.log(`[AUTO-DOUBLECHECK] Re-running all sources on ${needsDoublecheck.length} uncertain records\n`);

    const rank = RANK;

    for (const { record, domain, companyName, location, oldStatus } of needsDoublecheck) {
      process.stdout.write(`  → [${companyName.slice(0,28)}]\n     `);
      try {
        const sections = [];
        const sourceLabels = [];

        const dcExa = await exaScrape(domain, location);
        process.stdout.write(`Exa(${dcExa?.pageCount ?? 0})... `);
        if (dcExa) { sections.push(dcExa.text); sourceLabels.push('Exa'); }

        const dcFc = await firecrawlScrape(domain);
        process.stdout.write(`FC(${dcFc?.pageCount ?? 0})... `);
        if (dcFc) { sections.push(dcFc.text); sourceLabels.push('Firecrawl'); }

        const dcSerp = await serpFallback(domain, companyName, location);
        process.stdout.write(`SERP(${dcSerp ? 'found' : 'none'})... `);
        if (dcSerp) { sections.push(dcSerp.text); sourceLabels.push('SerpAPI'); }

        if (sections.length === 0) {
          process.stdout.write(`still no content\n`);
          continue;
        }

        const combinedText = sections.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        const dcResult = await classifyWithGemini(domain, companyName, { text: combinedText, source: 'Multi-source' });
        process.stdout.write(`${dcResult.icpStatus}\n`);

        const upgraded = (rank[dcResult.icpStatus] ?? -1) > (rank[oldStatus] ?? -1);
        const changed  = dcResult.icpStatus !== oldStatus;
        const changeTag = upgraded
          ? `[UPGRADED: ${oldStatus} → ${dcResult.icpStatus}]`
          : changed
          ? `[CHANGED: ${oldStatus} → ${dcResult.icpStatus}]`
          : `[Double-checked ✓]`;

        const tradesStr   = (dcResult.trades || []).join(', ');
        const keywordsStr = Object.entries(dcResult.matchedKeywords || {})
          .map(([t, kws]) => `${t}: ${kws.join(', ')}`).join('\n');

        await base(TABLE).update(record.id, {
          'ICP Status':       dcResult.icpStatus,
          'Trade Category':   tradesStr,
          'Contractor Flag':  dcResult.contractorFlag ? 'Yes' : 'No',
          'Matched Keywords': keywordsStr,
          'Fit Reason':       `${changeTag}\nSources: ${sourceLabels.join(' + ')}\nLocation: ${location || 'unknown'}\n\n${dcResult.reason}`,
          'Exa Content':      combinedText.slice(0, 100000),
          'Data Source':      sourceLabels[0] || 'Multi-source',
          'Double Checked':   true,
          'Enriched At':      new Date().toISOString(),
        });

        // Update counts: remove old, add new
        counts[oldStatus] = Math.max(0, (counts[oldStatus] || 0) - 1);
        counts[dcResult.icpStatus] = (counts[dcResult.icpStatus] || 0) + 1;

        const icon = ICP_POSITIVE.includes(dcResult.icpStatus) ? '✓'
                   : dcResult.icpStatus === 'Partial ICP' ? '~' : '✗';
        const tag  = changed ? ` ${oldStatus} → ${dcResult.icpStatus}` : ` confirmed ${dcResult.icpStatus}`;
        console.log(`  ${icon} ${companyName.slice(0,33).padEnd(33)} | ${(sourceLabels[0]||'').padEnd(10)} | ${dcResult.icpStatus.padEnd(18)} | ${tradesStr}${tag}`);

      } catch (err) {
        console.error(`  ✗ ERROR ${companyName} (doublecheck): ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 400));
    }
  }

  console.log('\n' + '═'.repeat(110));
  Object.entries(counts).forEach(([k, v]) => v > 0 && console.log(`  ${k.padEnd(22)} ${v}`));
}

main().catch(console.error);
