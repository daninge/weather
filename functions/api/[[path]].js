export async function onRequestGet(context) {
  const { params } = context;
  const path = Array.isArray(params.path) ? params.path.join("/") : params.path;
  const url = new URL(context.request.url);
  const target = `https://api.elections.kalshi.com/trade-api/v2/${path}${url.search}`;

  const resp = await fetch(target, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "kalshi-weather-app",
    },
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120",
    },
  });
}
