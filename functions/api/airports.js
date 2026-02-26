export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const airportsUrl = new URL("/airports.json", url.origin);

  const airportsRes = await fetch(airportsUrl.toString());
  if (!airportsRes.ok) return json({ ok: false, error: "airports.json missing" }, 500);

  const airportsJson = await airportsRes.json(); // { airports: [...] }

  const rows = await env.DB.prepare(
    `SELECT to_code, price, currency, updated_at, dep, arr, ret_dep, ret_arr, direct, link
     FROM prices`
  ).all();

  const byCode = new Map();
  for (const r of rows.results || []) byCode.set(r.to_code, r);

  const airports = (airportsJson.airports || []).map(a => {
    const p = byCode.get(a.iata_city_code) || null;
    return {
      city_name: a.city_name,
      country: a.country,
      slug: a.slug,
      iata_city_code: a.iata_city_code,
      cheapest: p ? {
        price: p.price,
        currency: p.currency || "EUR",
        updated_at: p.updated_at,
        dep: p.dep,
        arr: p.arr,
        ret_dep: p.ret_dep,
        ret_arr: p.ret_arr,
        direct: !!p.direct,
        link: p.link
      } : null
    };
  });

  return json({ ok: true, total: airports.length, airports });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}