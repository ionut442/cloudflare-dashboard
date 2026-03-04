export async function onRequestPost({ request, env }) {
  const body = await safeJson(request);
  const fileRef = String(body?.file_ref || "").trim();

  if (!/^[A-Za-z0-9_-]+\.json$/.test(fileRef)) {
    return json({ ok: false, error: "file_ref required (example: TIA.json)" }, 400);
  }

  const toCode = fileRef.replace(/\.json$/i, "").toUpperCase();
  const nightsPref = await resolveNightsPref(request.url, toCode);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload = JSON.stringify({ file_ref: fileRef });

  await env.DB.prepare(
    `INSERT INTO requests (id, created_at, from_code, to_code, nights_pref, status, payload, result)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL)`
  ).bind(id, now, "BUH", toCode, nightsPref, payload).run();

  return json({ ok: true, id, created_at: now, to_code: toCode, file_ref: fileRef });
}

async function resolveNightsPref(requestUrl, toCode) {
  try {
    const url = new URL(requestUrl);
    const airportsUrl = new URL("/airports.json", url.origin);
    const res = await fetch(airportsUrl.toString());
    if (!res.ok) return "3";

    const data = await res.json();
    const list = data?.airports || [];
    const item = list.find(a => String(a?.iata_city_code || "").toUpperCase() === toCode);
    const nights = String(item?.number_of_nights || "");
    return ["3", "5-7"].includes(nights) ? nights : "3";
  } catch {
    return "3";
  }
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
