// functions/api/textbooks.js
//
// Live proxy of Kerala SCERT API with a 1-hour edge cache. Replaces the
// previous D1 mirror (which had a cross-medium mapping bug because Kerala
// itself returns books under multiple mediums per endpoint).
//
// Contract preserved for /root/samagra/samagra-textbooks/website/src/api.ts:
//   { textbooks: Textbook[], subjects: Subject[], total, mediumId, classId }
//
// Cache API strategy (per edge POP, ~1 hour TTL):
//   - The Cache API is the simplest KV-free caching; if origin (Kerala) gets
//     overloaded we can graduate to KV (TEXTBOOKS_CACHE) later without
//     touching the worker contract.

const KERALA = 'https://samagra.kite.kerala.gov.in/v2/api/public/getSubjectTextbooks';
const CACHE_TTL = 3600; // 1 hour

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': `public, max-age=${CACHE_TTL}`,
};

function emptyResponse(mediumId, classId) {
  return {
    textbooks: [],
    subjects: [],
    total: 0,
    mediumId,
    classId,
  };
}

function buildCacheKey(request) {
  // Cache by full query (medium/class/subject/search). Vary partitioning
  // is intentionally not used; the query string is the cache key.
  return new Request(request.url, { method: 'GET' });
}

function mapSubjects(rawSubjects) {
  return rawSubjects.map((s) => ({
    id: Number(s.id),
    subjectName: s.subjectName ?? null,
    subjectGroupId: s.subjectGroupId != null ? Number(s.subjectGroupId) : null,
  }));
}

function mapTextbooks(rawTextbooks, subjectsById, mediumId, classId) {
  return rawTextbooks.map((t) => {
    const subj = subjectsById.get(Number(t.subjectId));
    const pdfRel = (t.chapterPdfUrl || '').replace(/^\/+/, '');
    const thumbRel = (t.chapterThumbUrl || '').replace(/^\/+/, '');
    return {
      id: Number(t.id),
      chapterName: t.chapterName ?? null,
      mediumId,
      classId,
      subjectId: t.subjectId != null ? Number(t.subjectId) : null,
      pdfUrl: pdfRel ? `/files/${pdfRel}` : null,
      thumbUrl: thumbRel ? `/files/${thumbRel}` : null,
      downloadState: 'complete',
      subjectName: subj ? subj.subjectName : null,
    };
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const mediumId = Number(url.searchParams.get('medium')) || 2;
  const classId = Number(url.searchParams.get('class')) || 12;
  const subjectParam = url.searchParams.get('subject');
  const subjectId = subjectParam ? Number(subjectParam) : null;
  const search = (url.searchParams.get('search') || '').trim();

  // 1. Cache hit fast-path.
  try {
    const cache = caches.default;
    const cacheKey = buildCacheKey(request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      // Re-emit with refreshed CORS header (Cloudflare strips sometimes).
      return new Response(await cached.text(), { headers: JSON_HEADERS });
    }
  } catch (e) {
    // Cache failure is non-fatal; fall through to live fetch.
  }

  // 2. Live fetch from Kerala.
  let body;
  try {
    const keralaRes = await fetch(`${KERALA}/${mediumId}/${classId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (samagra-mirror)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!keralaRes.ok) {
      return new Response(
        JSON.stringify({ error: `Kerala upstream returned ${keralaRes.status}`, ...emptyResponse(mediumId, classId) }),
        { status: 502, headers: { ...JSON_HEADERS, 'cache-control': 'no-store' } }
      );
    }
    body = await keralaRes.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Kerala upstream unreachable: ${err.message}`, ...emptyResponse(mediumId, classId) }),
      { status: 502, headers: { ...JSON_HEADERS, 'cache-control': 'no-store' } }
    );
  }

  if (!body || body.status !== 'success' || !body.data) {
    return new Response(
      JSON.stringify({ error: `Kerala upstream rejected: status=${body?.status}`, ...emptyResponse(mediumId, classId) }),
      { status: 502, headers: { ...JSON_HEADERS, 'cache-control': 'no-store' } }
    );
  }

  const rawSubjects = Array.isArray(body.data.subjectData) ? body.data.subjectData : [];
  const rawTextbooks = Array.isArray(body.data.textbookData) ? body.data.textbookData : [];

  // Kerala returns the full subject catalog (~40 subjects) for every
  // (medium, class) request, regardless of medium. Most of these are orphan
  // in the corresponding textbookData (German, Russian, Latin, Syriac,
  // Urdu, French, ...). Culling them down to subjects that have ≥1 textbook
  // here gives the wheel a sane, medium-coherent list.
  const visibleSubjectIds = new Set();
  for (const t of rawTextbooks) {
    if (t && t.subjectId != null) visibleSubjectIds.add(Number(t.subjectId));
  }
  const filteredSubjects = rawSubjects.filter(
    (s) => s && s.id != null && visibleSubjectIds.has(Number(s.id))
  );

  // Build a join map so we can stamp subjectName per textbook.
  const subjectsById = new Map();
  for (const s of filteredSubjects) {
    if (s && s.id != null) subjectsById.set(Number(s.id), s);
  }

  let textbooks = mapTextbooks(rawTextbooks, subjectsById, mediumId, classId);

  // 3. Worker-side subject + search filters.
  if (subjectId != null && !Number.isNaN(subjectId)) {
    textbooks = textbooks.filter((b) => b.subjectId === subjectId);
  }
  if (search) {
    const q = search.toLowerCase();
    textbooks = textbooks.filter(
      (b) =>
        (b.chapterName && b.chapterName.toLowerCase().includes(q)) ||
        (b.subjectName && b.subjectName.toLowerCase().includes(q))
    );
  }

  const responseBody = {
    textbooks,
    subjects: mapSubjects(filteredSubjects),
    total: textbooks.length,
    mediumId,
    classId,
  };

  const response = new Response(JSON.stringify(responseBody), { headers: JSON_HEADERS });

  // 4. Best-effort cache the response (ignore cache failures).
  try {
    const cache = caches.default;
    const cacheKey = buildCacheKey(request);
    // Cache needs a Response with explicit Cache-Control; we already set one.
    await cache.put(cacheKey, response.clone());
  } catch (e) {
    // ignore
  }

  return response;
}
