const CITIES = {
  "new-york":      { high: "KXHIGHNY",    low: "KXLOWTNYC",  rain: "KXRAINNYC" },
  "chicago":       { high: "KXHIGHCHI",   low: "KXLOWTCHI",  rain: "KXRAINCHIM" },
  "miami":         { high: "KXHIGHMIA",   low: null,         rain: "KXRAINMIAM" },
  "denver":        { high: "KXHIGHDEN",   low: "KXLOWTDEN",  rain: "KXRAINDENM" },
  "austin":        { high: "KXHIGHAUS",   low: null,         rain: "KXRAINAUSM" },
  "los-angeles":   { high: "KXHIGHLAX",   low: "KXLOWTLAX",  rain: "KXRAINLAXM" },
  "las-vegas":     { high: "KXHIGHTLV",   low: null,         rain: null },
  "washington-dc": { high: "KXHIGHTDC",   low: null,         rain: null },
  "seattle":       { high: "KXHIGHTSEA",  low: null,         rain: "KXRAINSEAM" },
  "new-orleans":   { high: "KXHIGHTNOLA", low: null,         rain: null },
  "san-francisco": { high: "KXHIGHTSFO",  low: null,         rain: "KXRAINSFOM" },
  "philadelphia":  { high: "KXHIGHPHIL",  low: null,         rain: null },
};

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const CACHE_TTL = 300;

async function kalshiFetch(seriesTicker) {
  const url = `${KALSHI}/events?series_ticker=${seriesTicker}&status=open&with_nested_markets=true`;
  const resp = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "kalshi-weather-app" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

function parseDateFromTicker(ticker) {
  const m = ticker.match(/(\d{2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  return `${2000 + parseInt(m[1])}-${String(months[m[2]] + 1).padStart(2, '0')}-${m[3]}`;
}

function parseTempEvents(data, type) {
  if (!data || !data.events) return [];
  return data.events.map(event => {
    const date = parseDateFromTicker(event.event_ticker);
    const markets = event.markets || [];
    if (!markets.length) return null;

    const bands = [];
    for (const m of markets) {
      const prob = (m.last_price || m.previous_price || 0) / 100;
      if (prob <= 0) continue;
      const st = (m.strike_type || "").toLowerCase();
      const floor = m.floor_strike;
      const cap = m.cap_strike;

      if (st === "between" && floor != null && cap != null) {
        bands.push({ low: floor, high: cap, mid: (floor + cap) / 2, prob, label: `${floor}-${cap}` });
      } else if (st === "greater" && floor != null) {
        bands.push({ low: floor, high: floor + 5, mid: floor + 2, prob, label: `>${floor}` });
      } else if (st === "less" && cap != null) {
        bands.push({ low: cap - 5, high: cap, mid: cap - 2, prob, label: `<${cap}` });
      }
    }

    if (!bands.length) return null;
    bands.sort((a, b) => a.mid - b.mid);

    const totalProb = bands.reduce((s, b) => s + b.prob, 0);
    const expected = totalProb > 0
      ? Math.round(bands.reduce((s, b) => s + b.mid * b.prob, 0) / totalProb)
      : null;

    const result = { date, expected };
    if (type === "high") result.bands = bands;
    return result;
  }).filter(Boolean);
}

function parseRainEvents(data) {
  if (!data || !data.events) return [];
  return data.events.map(event => {
    const date = parseDateFromTicker(event.event_ticker);
    const m = (event.markets || [])[0];
    if (!m) return null;
    const prob = (m.last_price || m.previous_price || 0) / 100;
    return { date, chance: Math.round(prob * 100) };
  }).filter(Boolean);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const slug = url.searchParams.get("name");
  const cfg = CITIES[slug];

  if (!cfg) {
    return new Response(JSON.stringify({ error: "Unknown city" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/city/${slug}`);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const fetches = [kalshiFetch(cfg.high)];
  if (cfg.low) fetches.push(kalshiFetch(cfg.low));
  if (cfg.rain) fetches.push(kalshiFetch(cfg.rain));

  const results = await Promise.all(fetches);

  let idx = 0;
  const highs = parseTempEvents(results[idx++], "high");

  let lows = [];
  if (cfg.low) lows = parseTempEvents(results[idx++], "low");

  let rains = [];
  if (cfg.rain) rains = parseRainEvents(results[idx++]);

  const body = JSON.stringify({ highs, lows, rains });

  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
    },
  });

  context.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
