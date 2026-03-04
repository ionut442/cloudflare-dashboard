export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "queued";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  const rows = await env.DB.prepare(
    `SELECT id, created_at, from_code, to_code, nights_pref, status, payload
     FROM requests
     WHERE status = ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).bind(status, limit).all();

  const requests = (rows.results || []).map(r => ({
    id: r.id,
    created_at: r.created_at,
    from_code: r.from_code,
    to_code: r.to_code,
    nights_pref: r.nights_pref,
    status: r.status,
    file_ref: getFileRef(r.payload)
  }));

  return json({ ok: true, status, count: requests.length, requests });
}

function getFileRef(payload) {
  try {
    return JSON.parse(payload || "{}")?.file_ref || null;
  } catch {
    return null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
