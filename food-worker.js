// Cloudflare Worker — natural-language food → {calories, protein} via Claude API.
//
// SETUP (one-time, ~10 min):
//   1. Get an API key at https://console.anthropic.com  (Settings → API Keys → Create)
//      Add ~$5 of credit; this worker uses ~$0.001 per food log.
//   2. Sign up at https://dash.cloudflare.com (free).
//   3. Workers & Pages → Create → "Hello World" worker.
//   4. Replace the worker code with the contents of THIS file.
//   5. Settings → Variables → Add variable:
//         Name:   ANTHROPIC_API_KEY
//         Value:  sk-ant-... (your key from step 1)
//         Encrypt: yes
//   6. Deploy. Copy the worker URL (e.g. https://food-estimator.YOURNAME.workers.dev).
//   7. In the Health page → Profile → Edit → paste URL into "Food estimator URL".
//
// The worker accepts POST { description: "turkey sandwich and apple" }
// and returns { items: [{ name, calories, protein_g }] }.

export default {
  async fetch(request, env) {
    // CORS preflight (so the dashboard can call from a different origin).
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid JSON' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const description = (body.description || '').trim();
    if (!description) {
      return new Response(JSON.stringify({ error: 'missing description' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const prompt = `You are a nutrition estimator. The user describes food they ate. Parse it into individual items and estimate calories and grams of protein for each.

Rules:
- Use realistic typical-portion estimates (e.g. "a slice of pizza" ≈ 285 cal).
- If they specify a portion (half, two, large), respect it.
- Round calories to the nearest 5; protein to the nearest gram.
- "name" should be a concise human label, capitalized (e.g. "Turkey sandwich", "Latte with whole milk").
- Output strictly valid JSON, no commentary.

Food description: "${description}"

Return JSON of this exact shape:
{"items": [{"name": "...", "calories": 0, "protein_g": 0}]}`;

    let apiResp;
    try {
      apiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'api fetch failed', detail: String(err) }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (!apiResp.ok) {
      const text = await apiResp.text();
      return new Response(JSON.stringify({ error: 'api error', status: apiResp.status, detail: text }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const data = await apiResp.json();
    const text = data.content?.[0]?.text || '';

    // Extract JSON from the model's response.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'no JSON in response', raw: text }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'JSON parse failed', raw: match[0] }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
