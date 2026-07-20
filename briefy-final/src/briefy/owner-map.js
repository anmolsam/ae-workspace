/**
 * PLACEHOLDER — fill this in with real {email: "Deal Owner name"} pairs before
 * anyone but you can log in. Login fails closed for any email not present here
 * (see architecturefinal.md > Auth flow) — this is required, not optional.
 *
 * The "Deal Owner name" values must match the Airtable "Deal Owner" field exactly
 * (that field holds the HubSpot owner's display name, e.g. "Varun Sharma").
 */
export const OWNER_MAP = {
  // 'varun@attentive.ai': 'Varun Sharma',
};

/**
 * @param {string} email
 * @returns {string | null} the mapped Airtable "Deal Owner" value, or null if unmapped
 */
export function getOwnerForEmail(email) {
  if (!email) return null;
  return OWNER_MAP[email.toLowerCase()] || null;
}
