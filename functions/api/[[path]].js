const CACHE_TTL = 300; // 5 minutes

export async function onRequestGet(context) {
  const { params } = context;
  const path = Array.isArray(params.path) ? params.path.join("/") : params.path;
  const url = new URL(context.request.url);
  const target = `https://api.elections.kalshi.com/trade-api/v2/${path}${url.search}`;

  const cache = caches.default;
  const cacheKey = new Request(target);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set("X-Cache", "HIT");
    return resp;
  }

  const resp = await fetch(target, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "kalshi-weather-app",
    },
  });

  if (!resp.ok) {
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "X-Cache": "ERROR",
      },
    });
  }

  const response = new Response(resp.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
      "X-Cache": "MISS",
    },
  });

  context.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
