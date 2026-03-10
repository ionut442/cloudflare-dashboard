export async function onRequest({ env }) {
  await ensureTable(env);

  const rows = await env.DB.prepare(
    `SELECT origin, destination, outbound_date, inbound_date, price_eur, momondo_url, airlines_json, updated_at
     FROM long_haul_deals
     ORDER BY price_eur ASC, outbound_date ASC`
  ).all();

  const deals = (rows.results || []).map((row) => ({
    origin: row.origin,
    destination: row.destination,
    route: `${row.origin} -> ${row.destination}`,
    outbound_date: row.outbound_date,
    inbound_date: row.inbound_date,
    price_eur: row.price_eur,
    momondo_url: row.momondo_url,
    airlines: parseAirlines(row.airlines_json),
    updated_at: row.updated_at
  }));

  return json({ ok: true, total: deals.length, deals });
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

function parseAirlines(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
