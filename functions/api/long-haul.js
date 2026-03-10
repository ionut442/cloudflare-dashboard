export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const dataUrl = new URL("/long-haul-flights.json", url.origin);

  const res = await fetch(dataUrl.toString());
  if (!res.ok) return json({ ok: false, error: "long-haul-flights.json missing" }, 500);

  const raw = await res.json();
  const deals = Array.isArray(raw)
    ? raw
        .map(normalizeDeal)
        .filter((deal) => deal && typeof deal.price_eur === "number" && deal.momondo_url)
    : [];

  return json({ ok: true, total: deals.length, deals });
}

function normalizeDeal(item) {
  const firstCard = Array.isArray(item?.cards) ? item.cards.find((card) => typeof card?.price_eur === "number") : null;
  if (!firstCard) return null;

  return {
    origin: String(item.origin || "").toUpperCase(),
    destination: String(item.destination || "").toUpperCase(),
    route: item.route || `${String(item.origin || "").toUpperCase()} -> ${String(item.destination || "").toUpperCase()}`,
    outbound_date: item.outbound_date || null,
    inbound_date: item.inbound_date || null,
    price_eur: firstCard.price_eur,
    momondo_url: item.momondo_url,
    airlines: Array.isArray(firstCard.airlines) ? firstCard.airlines : []
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
