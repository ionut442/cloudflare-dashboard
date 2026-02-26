export async function onRequestPost({ request, env }) {
  const body = await safeJson(request);
  if (!body || !Array.isArray(body.results)) {
    return json({ ok: false, error: "Body must be { from_code, currency, results: [] }" }, 400);
  }

  const currency = (body.currency || "EUR").toUpperCase();

  // load airports meta
  const url = new URL(request.url);
  const airportsRes = await fetch(new URL("/airports.json", url.origin).toString());
  const airportsJson = airportsRes.ok ? await airportsRes.json() : { airports: [] };
  const meta = new Map((airportsJson.airports || []).map(a => [a.iata_city_code, a]));

  // compute cheapest per destination
  const best = new Map(); // to_code -> item
  for (const r of body.results) {
    if (!r || !r.to || typeof r.price !== "number") continue;
    const toCode = String(r.to).toUpperCase();
    const cur = best.get(toCode);
    if (!cur || r.price < cur.price) best.set(toCode, r);
  }

  const now = new Date().toISOString();
  const stmts = [];

  for (const [toCode, r] of best.entries()) {
    const m = meta.get(toCode) || {};
    stmts.push(
      env.DB.prepare(
        `INSERT INTO prices
          (to_code, city_name, country, slug, price, currency, updated_at, dep, arr, ret_dep, ret_arr, direct, link)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(to_code) DO UPDATE SET
          city_name=excluded.city_name,
          country=excluded.country,
          slug=excluded.slug,
          price=excluded.price,
          currency=excluded.currency,
          updated_at=excluded.updated_at,
          dep=excluded.dep,
          arr=excluded.arr,
          ret_dep=excluded.ret_dep,
          ret_arr=excluded.ret_arr,
          direct=excluded.direct,
          link=excluded.link`
      ).bind(
        toCode,
        m.city_name || null,
        m.country || null,
        m.slug || null,
        r.price,
        currency,
        now,
        r.dep || null,
        r.arr || null,
        r.ret_dep || null,
        r.ret_arr || null,
        r.direct ? 1 : 0,
        r.link || null
      )
    );
  }

  if (stmts.length) await env.DB.batch(stmts);

  return json({ ok: true, updated: stmts.length, at: now });
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