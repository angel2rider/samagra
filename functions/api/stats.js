// functions/api/stats.js
//
// Counts total textbooks across ALL mediums × classes by fetching every
// combination from the Kerala SCERT API, batching in groups of 8 to avoid
// rate-limiting the upstream. Cached 1 hour via Cache API.

const KERALA = 'https://samagra.kite.kerala.gov.in/v2/api/public/getSubjectTextbooks';
const CACHE_TTL = 3600;
const BATCH_SIZE = 8;

const MEDIUMS = [1, 2, 3, 4];  // Malayalam, English, Tamil, Kannada
const CLASSES = Array.from({ length: 12 }, (_, i) => i + 1); // 1–12

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': `public, max-age=${CACHE_TTL}, stale-while-revalidate=${CACHE_TTL}`,
};

export async function onRequest(context) {
  const { request } = context;

  // Cache hit fast-path
  try {
    const cache = caches.default;
    const cacheKey = new Request(request.url, { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(await cached.text(), { headers: JSON_HEADERS });
    }
  } catch { /* fall through */ }

  // Build all (medium, class) pairs
  const pairs = [];
  for (const m of MEDIUMS) {
    for (const c of CLASSES) {
      pairs.push({ medium: m, class: c });
    }
  }

  // Fetch in batches
  let grandTotal = 0;
  try {
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(({ medium, class: cls }) =>
          fetch(`${KERALA}/${medium}/${cls}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (samagra-mirror-stats)' },
            signal: AbortSignal.timeout(10_000),
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );

      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const body = result.value;
        if (body?.status !== 'success' || !body?.data) continue;
        const td = body.data.textbookData;
        if (Array.isArray(td)) grandTotal += td.length;
      }
    }
  } catch {
    // Degrade gracefully — return whatever we counted so far, or 0
  }

  const resp = new Response(
    JSON.stringify({ totalComplete: grandTotal }),
    { headers: JSON_HEADERS }
  );

  // Cache it
  try {
    await caches.default.put(
      new Request(request.url, { method: 'GET' }),
      resp.clone()
    );
  } catch { /* ignore */ }

  return resp;
}
