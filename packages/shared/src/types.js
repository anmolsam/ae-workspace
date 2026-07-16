/**
 * Shared entity shapes (JSDoc typedefs). Kept framework-agnostic so both the
 * API and a future Chrome extension can depend on the same contracts. These
 * describe the DTOs the API returns from /api/v1/me/* — stable entity IDs, no
 * business logic in the shape.
 */

/**
 * @typedef {Object} FollowUp   The Taskee card DTO.
 * @property {string} id                 Stable app-local task id.
 * @property {string} dealId             HubSpot deal id.
 * @property {string} companyName
 * @property {string} dealName
 * @property {string} stageLabel         e.g. "Discovery Ongoing".
 * @property {'DS'|'DO'|'OI'} track
 * @property {number} slot               Follow-up number (0..4).
 * @property {string} followUpLabel      e.g. "Follow-Up 2 · Discovery Ongoing".
 * @property {string} draft              AI-generated email draft body.
 * @property {string} draftGeneratedAt   ISO — from HubSpot generated_at field.
 * @property {string} overdueAt          ISO — draftGeneratedAt + 24h.
 * @property {string} state              TASK_STATE value.
 * @property {boolean} checked           UI convenience (derived from state).
 * @property {boolean} overdue           Derived.
 * @property {string|null} verifiedCompletedAt
 * @property {string} hubspotDealUrl     Direct deep link.
 * @property {string} bucket             'overdue'|'today'|'tomorrow'|'upcoming'|'week'
 */

/**
 * @typedef {Object} TaskeeSummary
 * @property {number} dueToday
 * @property {number} overdue
 * @property {number} thisWeek
 */

/**
 * @typedef {Object} FunnelStage
 * @property {string} key        'demos'|'dcc'|'qdd'|'pilots'|'cw'
 * @property {string} label
 * @property {number} count
 * @property {number|null} pct   Conversion % vs its basis.
 * @property {string} basisLabel e.g. "of DCC".
 */

/**
 * @typedef {Object} Funnel     Scoped to the logged-in AE (from ROMA).
 * @property {string} aeName
 * @property {string} team      'ACE'|'SPADE'|'CLUB'
 * @property {FunnelStage[]} stages
 * @property {string} generatedAt
 * @property {string} source    Always 'roma' — never recomputed locally.
 */

/**
 * @typedef {Object} FightScore  Scoped to the logged-in AE (from ROMA).
 * @property {string} aeName
 * @property {string} team
 * @property {number} score      0..100, ROMA's pooled done/known.
 * @property {number} deals
 * @property {number} known
 * @property {number} done
 * @property {number} lt80
 * @property {string} generatedAt
 * @property {string} source     Always 'roma'.
 */

/**
 * @typedef {Object} Meeting     Briefy list item.
 * @property {string} id
 * @property {string} title
 * @property {string} company
 * @property {string} startsAt   ISO.
 * @property {string[]} attendees
 * @property {'ready'|'generating'|'needs_data'|'completed'} briefStatus
 * @property {string|null} briefId
 */

/**
 * @typedef {Object} PreCallBrief
 * @property {string} id
 * @property {string} meetingId
 * @property {'queued'|'processing'|'completed'|'failed'} jobStatus
 * @property {BriefSection[]} sections   Dynamic — renderer must not assume a fixed schema.
 * @property {ResearchSource[]} sources
 * @property {string} generatedAt
 */

/**
 * @typedef {Object} BriefSection
 * @property {string} key
 * @property {string} title
 * @property {number} order
 * @property {'markdown'|'list'|'keyvalue'} kind
 * @property {*} content
 */

/**
 * @typedef {Object} ResearchSource
 * @property {string} provider   'jina'|'exa'|'zoominfo'|'seamless'
 * @property {string} kind       'company'|'person'
 * @property {string} fetchedAt
 */

export const BUCKETS = ['overdue', 'today', 'tomorrow', 'upcoming', 'week'];
export const ROLES = ['AE', 'TEAM_LEAD', 'REVOPS_ADMIN', 'SALES_LEADERSHIP'];
