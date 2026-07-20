# ICP Match — Agent System Documentation

## What This Does

Automatically qualifies inbound demo leads against ibeam.ai's Ideal Customer Profile (ICP).
Reads company domains from Airtable, scrapes the web via a 4-source cascade, classifies with Gemini 2.5 Pro, and writes structured results back to Airtable.

### Output fields (per lead)

| Field | Values |
|---|---|
| ICP Status | ICP - Contractor / ICP - Supplier / ICP - Both / Partial ICP / Not ICP / Not Found |
| Trade Category | Comma-separated trades matched (e.g. "Roofing, Sheet Metal") |
| Contractor Flag | Yes / No |
| Matched Keywords | Exact phrases from the website per trade |
| Fit Reason | 2-3 sentence explanation |
| Exa Content | Full raw scraped text (for human review) |
| Pages Scraped | All URLs fetched |
| Data Source | All sources that contributed, joined: e.g. "Exa + Firecrawl" |
| Double Checked | true if auto-doublecheck ran |
| Personal Email | true if domain is gmail/yahoo/etc |
| Enriched At | ISO timestamp |

---

## Setup

```bash
git clone <repo-url>
cd icp-match
npm install
cp .env.example .env   # fill in your keys
```

### Required `.env` keys

```env
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=appDim1drDa78bk9G

EXA_API_KEY=...
FIRECRAWL_API_KEY=fc-...
SERPAPI_KEY=...

ZOOMINFO_CLIENT_ID=...
ZOOMINFO_CLIENT_SECRET=...

REQUESTY_API_KEY=rqsty-sk-...   # LLM gateway — routes to Gemini 2.5 Pro
```

---

## Scripts

| Script | Purpose | When to run |
|---|---|---|
| `node src/icp-final.js` | Main pipeline — all unclassified records in "ICP Match Final" | New leads |
| `node src/icp-final.js --limit=N` | First N unprocessed records | Testing / batching |
| `node src/icp-final.js --domain=foo.com` | Re-run a single specific domain | Debug a record |
| `node src/icp-final.js --retry` | Re-run records where Exa found 0 pages | After Exa failures |
| `node src/icp-final.js --refetch` | Re-run ZoomInfo/SerpAPI/Not Found records with richer context | Quality pass |
| `node src/icp-final.js --doublecheck` | Re-run all Partial ICP / Not ICP with all 4 sources | Quality pass |
| `node src/run-test-table.js` | Full pipeline for "ICP Match Test - Prashant" tab (discovers domains too) | Test runs |

---

## Pipeline — Step by Step

### icp-final.js (main pipeline)

Runs on every record in **"ICP Match Final"** that has a domain but no Exa Content yet.

```
Domain
  │
  ├─ Personal Email check
  │    gmail/yahoo/hotmail/outlook/etc → ICP Status = Not ICP, Personal Email = true, STOP
  │
  ▼
Step 1: Exa AI scrape
  Direct fetch of 17 URL paths per domain:
    /  /about  /about-us  /services  /service  /what-we-do
    /products  /product  /projects  /our-work  /work  /trades  /specialties
    + www.* variants of all above
  Domain search: Exa keyword search restricted to domain (8 results)
  Dedup by URL
  External fallback: if ZERO pages found → open web search for the company
    (finds BBB, LinkedIn, Yelp, Google Business, news articles, directories)
  → context set if any pages found
  → Data Source: "Exa"

Step 2: Firecrawl supplement (only if Exa thin: < 2 pages OR < 2000 chars)
  Sequential scrape of 5 pages: /  /about-us  /about  /services  /what-we-do
  onlyMainContent: true, 4000 char limit per page
  If Exa had content → merged into context (Exa + Firecrawl combined)
  If Exa had nothing → Firecrawl becomes primary context
  → Data Source: "Exa + Firecrawl" or "Firecrawl"

Step 3: ZoomInfo fallback (only if Steps 1+2 found NOTHING)
  GTM Enrich API — returns industry, headcount, revenue, location, ownership type
  Rich structured data, classified with relaxed rules (no keyword threshold needed)
  → Data Source: "ZoomInfo"

Step 4: SerpAPI fallback (only if Steps 1+2+3 found NOTHING)
  Query 1: Google organic + Knowledge Graph + local pack
    → extracts: Business Type, Description, Address, organic snippets
  Query 2: Google Maps direct search
    → extracts: business type, address, website, phone
  Domain warning injected so Gemini ignores name collisions
  → Data Source: "SerpAPI"

Step 5: Not Found
  All 4 sources returned nothing → ICP Status = Not Found

Step 6: Gemini 2.5 Pro classification
  Model: google/gemini-2.5-pro via Requesty
  Input: scraped content + COMPANY QUALIFIER v2 + SUPPLIER QUALIFIER
  Task instructions differ based on Data Source:
    - Exa/Firecrawl: keyword-match mode (2+ per trade / 3+ supplier)
    - ZoomInfo: industry-classification mode (no keyword threshold)
    - SerpAPI: search-signal mode (business type = direct trade signal)
  Output: icpStatus, contractorFlag, trades[], matchedKeywords{}, reason

Step 7: Auto-doublecheck (automatic, no flag needed)
  Triggers on: Partial ICP / Not ICP / Not Found
  Runs ALL THREE sources simultaneously (not cascade):
    Exa + Firecrawl + SerpAPI → combine all content → Gemini
  If result rank improves → UPGRADED, updates all fields
  If result changes (not improved) → CHANGED
  If same → Double-checked ✓ confirmed
  Data Source = joined list of all sources that returned content
  Double Checked = true always
```

### run-test-table.js (test table pipeline)

Same as above but reads from **"ICP Match Test - Prashant"** tab.
Additional step before Step 1: **Domain Discovery**
  - If Company Domain is blank → SerpAPI query: `"Company Name" location official website`
  - Skips social/directory sites (Facebook, LinkedIn, Yelp, BBB, etc.)
  - Saves discovered domain back to Airtable before scraping

---

## ICP Classification Logic

### Classifier: COMPANY QUALIFIER v2

Contractor threshold: **2+ keyword matches per trade**. One company can match multiple trades.

| Trade | Example keywords |
|---|---|
| Electrical | electrical contractor, electrician, conduit, wiring, IBEW, journeyman |
| Mechanical / HVAC | HVAC, ductwork, chiller, boiler, air handler, BAS, sheet metal contract |
| Plumbing | plumber, pipe fitting, backflow, sewer install, fire suppression |
| Concrete | ready-mix, flatwork, slab, tilt-up, shotcrete, core drill |
| Rebar | rebar, reinforcing steel, ironworker, post-tension, welded wire mesh |
| Structural Steel | steel erection, fabricator, AISC, steel beam, ironworker |
| Civil | civil contractor, site prep, grading, SWPPP, underground utility |
| Utility | utility contractor, power line, directional drill, HDD, trenchless |
| Earthwork | excavation, grading, demolition, backfill, pile driving |
| General Contractor | general contractor, design-build, CM at risk, turnkey construct |
| Roofing | roofer, TPO, EPDM, shingle, flat roof, roof membrane |
| Flooring | flooring, LVT, VCT, carpet install, epoxy floor, terrazzo |
| Finishing | finishing contract, millwork, casework, acoustical ceiling |
| Painting | painting contractor, commercial paint, epoxy coating, intumescent |
| Drywall | drywall, sheetrock, metal stud framing, tape and finish |
| Lumber & Framing | lumber, framing contractor, truss, LVL, OSB |
| Masonry | masonry, brick, CMU, tuckpoint, stone veneer |
| Landscape & Irrigation | landscaping, irrigation, hardscape, sod install, turf |
| Paving | asphalt, sealcoat, parking lot striping, slurry seal |
| Specialty | glazing, spray foam, waterproofing, curtain wall, abatement |
| FMS | facility management, janitorial, CMMS, preventive maintenance |
| Snow Removal | snow plowing, ice management, de-icing, salting |
| LC + LM | landscape construction + management, design-build + landscape |
| LC | landscape construction, landscape installation, hardscape construct |
| LM | landscape management, grounds maintenance, lawn care service |

### Classifier: SUPPLIER QUALIFIER

Supplier threshold: **3+ keyword matches** (higher bar than contractor).

Keywords: distributor, distribution company/center, wholesale/wholesaler, supply house, industrial supply, construction supply, building supply/materials, manufacturer (of construction products), product catalog, SKU, inventory, in stock, order online, add to cart, bulk pricing, trade pricing, contractor pricing, warehouse, fulfillment center, HVAC supply, electrical supply, plumbing supply, roofing supply, lumber yard, building materials, fasteners, pipe supply, duct supply, safety supply, tool distributor.

### Classification Steps (Gemini follows this order)

**Step 1 — Hard Disqualifiers (highest priority)**
If clearly and strongly evidenced → assign matching Non-ICP immediately. Never disqualify on weak evidence.

**Step 2 — Positive ICP Check**
No hard disqualifiers found: check COMPANY QUALIFIER v2 (2+ per trade) and SUPPLIER QUALIFIER (3+).

**Step 3 — Soft Exclusion Check**
Only if Step 2 found no positive signals: check soft exclusion categories.

**Step 4 — Partial ICP**
Construction signals below threshold, mixed signals, or ambiguous evidence.

### ICP Status Matrix

| Signal | Status |
|---|---|
| 2+ keyword matches in any contractor trade | ICP - Contractor |
| 3+ supplier signals, clearly serves construction | ICP - Supplier |
| Both contractor AND supplier thresholds met | ICP - Both |
| Below threshold, mixed, ambiguous | Partial ICP |
| Homeowner / student / competitor / non-construction / software / staffing / govt / architect-only / engineer-only / investor / owner-builder | Non-ICP - Company type mismatch |
| Irrigation-only / pools-only / security-only / low-voltage-only / fire-suppression-only / traffic-only / property-mgmt-only / janitorial-only / restoration-only / service-only / residential-only / industrial-only HVAC or Plumbing — primarily serves manufacturing plants, refineries, oil & gas, or industrial facilities with process piping, equipment maintenance, capital project installs, or production uptime services (even if they say "industrial AND commercial customers" — commercial here = business clients, NOT commercial buildings). Only ICP if they clearly also install in commercial buildings (offices, schools, hospitals, retail, multi-family). | Non-ICP - Trade or work-type exclusions |
| Handyman / solo operator / too small (1-2 person, no crews) | Non-ICP - Business viability exclusions |
| French-only or non-English-only operations | Non-ICP - Language or geography mismatch |
| Fake website / parked domain / spam / no real company presence | Non-ICP - Lead quality exclusions |
| No bidding or estimating / service-call-only / no takeoff need | Non-ICP - Need mismatch |
| All sources returned nothing | Not Found |

### Conservative rules
- Never disqualify on weak, vague, or single-word evidence
- Company does both residential AND commercial → do NOT disqualify (not residential-only)
- Company does service/maintenance AND project construction → do NOT disqualify (not service-only)
- When in doubt between Non-ICP and Partial ICP → choose Partial ICP

### Rank order (for doublecheck upgrade logic)

```
Not Found = Non-ICP - [any] = 0 → Partial ICP = 1 → ICP - Contractor = ICP - Supplier = 2 → ICP - Both = 3
```

Auto-doublecheck triggers on: Partial ICP, Not Found, or any `Non-ICP - ...` status.
Only updates Airtable if new rank ≥ old rank (never downgrades).

---

## Data Source Field Values

Single-select with all possible values:

| Value | Meaning |
|---|---|
| Exa | Only Exa found content, Firecrawl not needed |
| Exa + Firecrawl | Exa thin → Firecrawl supplemented |
| Firecrawl | Exa found nothing, Firecrawl was the source |
| ZoomInfo | Exa + Firecrawl both failed, ZoomInfo used |
| SerpAPI | All web scrapers failed, only Google search data |
| Exa + SerpAPI | Doublecheck: Exa + SerpAPI both returned content |
| Exa + Firecrawl + SerpAPI | Doublecheck: all three returned content |
| Firecrawl + SerpAPI | Doublecheck: Exa empty, FC + SERP returned content |
| Exa + ZoomInfo | Doublecheck mode: both returned content |
| Multi-source | (legacy) combined sources |
| Personal Email | Domain is gmail/yahoo/hotmail/etc |
| Not Found | Nothing found anywhere |

---

## Airtable Tables

| Table | Purpose |
|---|---|
| ICP Match Final | Production — all inbound leads |
| ICP Match Test - Prashant | Test runs — 25 planted records including fakes |

### Fields added to both tables

All fields were added via Airtable Meta API. Field IDs for "ICP Match Final":

| Field | Type | Airtable Field ID |
|---|---|---|
| ICP Status | singleSelect | fldJ0... |
| Trade Category | multilineText | — |
| Contractor Flag | singleLineText | — |
| Matched Keywords | multilineText | — |
| Fit Reason | multilineText | — |
| Exa Content | multilineText | — |
| Pages Scraped | multilineText | — |
| Data Source | singleSelect | fldz6bgW5GMAW1Tt8 |
| Double Checked | checkbox | — |
| Personal Email | checkbox | — |
| Enriched At | dateTime | — |

---

## Architecture Diagram

```
Airtable "ICP Match Final"
  (domain in Company domain field, Exa Content = blank)
          │
          ▼
  ┌─────────────────────────────────────────────────────┐
  │  icp-final.js                                       │
  │                                                     │
  │  Personal Email? → Not ICP, skip                   │
  │                                                     │
  │  Step 1: Exa AI                                     │
  │    - 17 direct page paths                           │
  │    - domain keyword search (8 results)              │
  │    - external fallback if 0 pages found             │
  │                                                     │
  │  Step 2: Firecrawl (if Exa thin < 2pg / < 2000ch)  │
  │    - sequential scrape of 5 pages                   │
  │    - supplement or replace Exa                      │
  │                                                     │
  │  Step 3: ZoomInfo (if Steps 1+2 = nothing)         │
  │    - GTM Enrich API                                 │
  │    - industry, headcount, location                  │
  │                                                     │
  │  Step 4: SerpAPI (if Steps 1+2+3 = nothing)        │
  │    - Google organic + Knowledge Graph               │
  │    - Google Maps                                    │
  │                                                     │
  │  Step 5: Not Found                                  │
  │                                                     │
  │  Step 6: Gemini 2.5 Pro                             │
  │    - COMPANY QUALIFIER v2 (22 trades, 2+ threshold) │
  │    - SUPPLIER QUALIFIER (3+ threshold)              │
  │    → icpStatus, trades, keywords, reason            │
  │                                                     │
  │  Step 7: Auto-doublecheck (if Partial/Not ICP/NF)  │
  │    - Exa + Firecrawl + SerpAPI ALL simultaneously  │
  │    - Gemini re-classifies on combined content       │
  │    - Only upgrades, never downgrades                │
  └─────────────────────────────────────────────────────┘
          │
          ▼
  Airtable write (typecast: true — creates new select options automatically)
  All fields updated: ICP Status, Trade Category, Matched Keywords,
  Fit Reason, Exa Content, Pages Scraped, Data Source, Double Checked, Enriched At
```

---

## LLMs Used

| Model | Provider | Role |
|---|---|---|
| `google/gemini-2.5-pro` | Requesty | ICP classification (both scripts) |
| `anthropic/claude-sonnet-4-6` | Requesty | Fallback (exa-classify.js) |
| `perplexity/sonar-pro` | Requesty | Web research fallback (classify-all.js) |

Gemini is called with `temperature: 0.1` for consistency. Prompt contains full COMPANY QUALIFIER v2 + SUPPLIER QUALIFIER on every call.

---

## Key Design Decisions

**Cascade, not supplement**: ZoomInfo and SerpAPI only run when ALL prior sources fail. They are not appended to Exa content. This keeps Data Source accurate and prevents Gemini from citing SERP data for a company that has good Exa content.

**Doublecheck runs all three in parallel**: Unlike the main cascade, the auto-doublecheck phase runs Exa + Firecrawl + SerpAPI simultaneously and combines everything. This gives Gemini maximum signal for borderline cases.

**Typecast writes**: All Airtable updates use `{ typecast: true }` so new combined Data Source values (e.g. "Exa + Firecrawl + SerpAPI") are created as select options automatically without needing schema changes.

**Rank-based upgrade only**: The doublecheck phase only changes a record if the new status ranks equal or higher. A "Not ICP" can become "ICP - Contractor" but never the reverse — this prevents good records from being regressed by a bad doublecheck scrape.

**Personal email detection**: 20+ personal email domains checked before any scraping. Personal email records are marked and skipped — they should never be scraped.

---

## Files

| File | Purpose |
|---|---|
| `src/icp-final.js` | Main production pipeline |
| `src/run-test-table.js` | Test table pipeline (with domain discovery) |
| `src/zoominfo.js` | ZoomInfo GTM Enrich API client |
| `src/airtable.js` | Airtable helpers (getRecords with pagination) |
| `src/automation.js` | Legacy: poll Demo Scheduled every 5min |
| `src/exa-classify.js` | Legacy: Exa + Claude fallback |
| `src/classify-all.js` | Legacy: Perplexity fallback |
| `src/fix-datasource-15.js` | One-time: retroactively fix Data Source for 15 records |
