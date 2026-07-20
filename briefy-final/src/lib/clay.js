import 'dotenv/config';

/**
 * Fire-and-forget trigger for Clay's async enrichment (revenue + org-tree supplement).
 * Clay's integration model is webhook-in/webhook-out — this only fires the trigger;
 * the result lands later via a webhook callback (see web/app/api/webhooks/clay).
 * Stubs cleanly if Clay isn't configured yet.
 * @param {{domain: string, dealId: string}} params
 * @returns {Promise<{status: 'triggered' | 'not_configured'}>}
 */
export async function triggerEnrichment({ domain, dealId }) {
  const webhookUrl = process.env.CLAY_WEBHOOK_URL;
  const apiKey = process.env.CLAY_API_KEY;
  if (!webhookUrl || !apiKey) return { status: 'not_configured' };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ domain, dealId }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Clay trigger failed: ${res.status} ${text.slice(0, 300)}`);
  }

  return { status: 'triggered' };
}
