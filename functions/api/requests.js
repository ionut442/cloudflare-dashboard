export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "queued";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  const rows = await env.DB.prepare(
    `SELECT id, created_at, from_code, to_code, nights_pref, status
     FROM requests
     WHERE status = ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).bind(status, limit).all();

  return json({ ok: true, status, count: (rows.results || []).length, requests: rows.results || [] });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}