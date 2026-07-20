import 'dotenv/config';

const REQUESTY_URL = 'https://router.requesty.ai/v1/chat/completions';

export async function chatCompletion({ model, messages, temperature = 0.1 }) {
  const res = await fetch(REQUESTY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.REQUESTY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`Requesty ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export function parseJsonResponse(raw) {
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${clean.slice(0, 200)}`);
  return JSON.parse(match[0]);
}
