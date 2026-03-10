export async function onRequestPost({ request, env }) {
  const body = await safeJson(request);
  if (!body || !Array.isArray(body.deals)) {
    return json({ ok: false, error: "Body must be { deals: [] }" }, 400);
  }

  await ensureTable(env);

  const now = new Date().toISOString();
  const normalized = body.deals
    .map(normalizeDeal)
    .filter(Boolean);

  if (!normalized.length) {
    return json({ ok: true, updated: 0, skipped: body.deals.length, at: now });
  }

  const stmts = [
    env.DB.prepare("DELETE FROM long_haul_deals")
  ];

  for (const deal of normalized) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO long_haul_deals
          (origin, destination, outbound_date, inbound_date, price_eur, momondo_url, airlines_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        deal.origin,
        deal.destination,
        deal.outbound_date,
        deal.inbound_date,
        deal.price_eur,
        deal.momondo_url,
        JSON.stringify(deal.airlines),
        now
      )
    );
  }

  await env.DB.batch(stmts);

  return json({
    ok: true,
    updated: normalized.length,
    skipped: body.deals.length - normalized.length,
    at: now
  });
}

function normalizeDeal(item) {
  if (!item) return null;

  const origin = String(item.origin || "").trim().toUpperCase();
  const destination = String(item.destination || "").trim().toUpperCase();
  const outboundDate = String(item.outbound_date || "").trim();
  const inboundDate = String(item.inbound_date || "").trim();
  const momondoUrl = String(item.momondo_url || "").trim();
  const price = Number(item.price_eur);

  if (!origin || !destination || !outboundDate || !inboundDate || !momondoUrl || !Number.isFinite(price)) {
    return null;
  }

  return {
    origin,
    destination,
    outbound_date: outboundDate,
    inbound_date: inboundDate,
    price_eur: price,
    momondo_url: momondoUrl,
    airlines: Array.isArray(item.airlines) ? item.airlines.map((a) => String(a)).filter(Boolean) : []
  };
}

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS long_haul_deals (
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      outbound_date TEXT NOT NULL,
      inbound_date TEXT NOT NULL,
      price_eur REAL NOT NULL,
      momondo_url TEXT NOT NULL,
      airlines_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (origin, destination, outbound_date, inbound_date)
    )`
  ).run();
}

async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
