export async function onRequestPost({ request, env }) {
  const body = await safeJson(request);
  const toCode = String(body?.to_code || "").toUpperCase();
  const nightsPref = String(body?.nights_pref || "");

  if (!toCode) return json({ ok: false, error: "to_code required" }, 400);
  if (!["3", "5-7"].includes(nightsPref)) {
    return json({ ok: false, error: "nights_pref must be '3' or '5-7'" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO requests (id, created_at, from_code, to_code, nights_pref, status, payload, result)
     VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL)`
  ).bind(id, now, "BUH", toCode, nightsPref).run();

  return json({ ok: true, id, created_at: now, to_code: toCode, nights_pref: nightsPref });
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