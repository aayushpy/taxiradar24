const POLL_SECONDS = 30;
const CACHE_SECONDS = 25;
const LTA_URL = "https://datamall2.mytransport.sg/ltaodataservice/Taxi-Availability";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/taxis") {
      return handleTaxis(request, env, ctx);
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: Boolean(env.LTA_ACCOUNT_KEY),
        runtime: "cloudflare-workers",
        poll_seconds: POLL_SECONDS,
      });
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleTaxis(request, env, ctx) {
  if (!env.LTA_ACCOUNT_KEY) {
    return json(
      {
        error: "LTA_ACCOUNT_KEY is not configured",
        hint: "Run: npx wrangler secret put LTA_ACCOUNT_KEY",
      },
      500,
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/taxis-cache", request.url), {
    method: "GET",
  });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const ts = Date.now() / 1000;
  const taxis = await fetchTaxis(env.LTA_ACCOUNT_KEY);
  const response = json({
    snapshots: [{ ts, taxis }],
    taxis,
    ts,
    poll_seconds: POLL_SECONDS,
  });
  response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function fetchTaxis(accountKey) {
  const out = [];
  let skip = 0;

  while (true) {
    const url = new URL(LTA_URL);
    url.searchParams.set("$skip", String(skip));
    const response = await fetch(url, {
      headers: { AccountKey: accountKey },
    });

    if (!response.ok) {
      throw new Error(`LTA request failed: ${response.status}`);
    }

    const data = await response.json();
    const page = Array.isArray(data.value) ? data.value : [];
    out.push(...normalise(page));

    if (page.length < 500) break;
    skip += 500;
  }

  return out;
}

function normalise(raw) {
  const out = [];

  for (const taxi of raw) {
    const lat = Number(taxi.Latitude);
    const lng = Number(taxi.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 1.15 || lat > 1.55 || lng < 103.55 || lng > 104.15) continue;
    out.push({ lat, lng });
  }

  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

