const CITIES = {
  "new-york":      { high: "KXHIGHNY",    highSlug: "highest-temperature-in-nyc",              low: "KXLOWTNYC",  lowSlug: "lowest-temperature-in-nyc",     rain: "KXRAINNYC",  rainSlug: "nyc-rain" },
  "chicago":       { high: "KXHIGHCHI",   highSlug: "highest-temperature-in-chicago",          low: "KXLOWTCHI",  lowSlug: "lowest-temperature-in-chicago", rain: "KXRAINCHIM", rainSlug: "rain-chicago" },
  "miami":         { high: "KXHIGHMIA",   highSlug: "highest-temperature-in-miami",            low: null, lowSlug: null,                                    rain: "KXRAINMIAM", rainSlug: "rain-miami" },
  "denver":        { high: "KXHIGHDEN",   highSlug: "highest-temperature-in-denver",           low: "KXLOWTDEN",  lowSlug: "lowest-temperature-in-denver",  rain: "KXRAINDENM", rainSlug: "rain-denver" },
  "austin":        { high: "KXHIGHAUS",   highSlug: "highest-temperature-in-austin",           low: null, lowSlug: null,                                    rain: "KXRAINAUSM", rainSlug: "rain-austin" },
  "los-angeles":   { high: "KXHIGHLAX",   highSlug: "highest-temperature-in-los-angeles",      low: "KXLOWTLAX",  lowSlug: "lowest-temperature-in-la",      rain: "KXRAINLAXM", rainSlug: "rain-los-angeles" },
  "las-vegas":     { high: "KXHIGHTLV",   highSlug: "highest-temperature-in-las-vegas",        low: null, lowSlug: null,                                    rain: null, rainSlug: null },
  "washington-dc": { high: "KXHIGHTDC",   highSlug: "highest-temperature-in-washington-dc",    low: null, lowSlug: null,                                    rain: null, rainSlug: null },
  "seattle":       { high: "KXHIGHTSEA",  highSlug: "highest-temperature-in-seattle",          low: null, lowSlug: null,                                    rain: "KXRAINSEAM", rainSlug: "rain-seattle" },
  "new-orleans":   { high: "KXHIGHTNOLA", highSlug: "highest-temperature-in-new-orleans",      low: null, lowSlug: null,                                    rain: null, rainSlug: null },
  "san-francisco": { high: "KXHIGHTSFO",  highSlug: "highest-temperature-in-san-francisco",    low: null, lowSlug: null,                                    rain: "KXRAINSFOM", rainSlug: "rain-san-francisco" },
  "philadelphia":  { high: "KXHIGHPHIL",  highSlug: "highest-temperature-in-philadelphia",     low: null, lowSlug: null,                                    rain: null, rainSlug: null },
};

const KALSHI_BASE = "https://kalshi.com/markets";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const CACHE_TTL = 300;

async function kalshiFetch(seriesTicker) {
  const url = `${KALSHI}/events?series_ticker=${seriesTicker}&status=open&with_nested_markets=true`;
  for (let i = 0; i < 3; i++) {
    const resp = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "kalshi-weather-app" },
    });
    if (resp.ok) return resp.json();
    if (resp.status !== 429) return null;
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

function parseDateFromTicker(ticker) {
  const m = ticker.match(/(\d{2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  return `${2000 + parseInt(m[1])}-${String(months[m[2]] + 1).padStart(2, '0')}-${m[3]}`;
}

function kalshiUrl(seriesTicker, seriesSlug, eventTicker) {
  return `${KALSHI_BASE}/${seriesTicker.toLowerCase()}/${seriesSlug}/${eventTicker.toLowerCase()}`;
}

function parseTempEvents(data, type, seriesTicker, seriesSlug) {
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

    const result = { date, expected, url: kalshiUrl(seriesTicker, seriesSlug, event.event_ticker) };
    if (type === "high") result.bands = bands;
    return result;
  }).filter(Boolean);
}

function parseRainEvents(data, seriesTicker, seriesSlug) {
  if (!data || !data.events) return [];
  return data.events.map(event => {
    const date = parseDateFromTicker(event.event_ticker);
    const m = (event.markets || [])[0];
    if (!m) return null;
    const prob = (m.last_price || m.previous_price || 0) / 100;
    return { date, chance: Math.round(prob * 100), url: kalshiUrl(seriesTicker, seriesSlug, event.event_ticker) };
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

  const allOk = results.every(r => r != null);

  let idx = 0;
  const highs = parseTempEvents(results[idx++], "high", cfg.high, cfg.highSlug);

  let lows = [];
  if (cfg.low) lows = parseTempEvents(results[idx++], "low", cfg.low, cfg.lowSlug);

  let rains = [];
  if (cfg.rain) rains = parseRainEvents(results[idx++], cfg.rain, cfg.rainSlug);

  const body = JSON.stringify({ highs, lows, rains });

  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": allOk ? `public, max-age=${CACHE_TTL}` : "no-store",
    },
  });

  if (allOk) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}
