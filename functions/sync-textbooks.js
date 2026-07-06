// functions/sync-textbooks.js
//
// Weekly cron-triggered worker that fetches all 48 (medium × class) textbook
// combos from Kerala's API, culls orphan subjects, and writes the unfiltered
// data to KV with a 1-week TTL.
//
// Also callable via HTTP GET for manual one-off syncs or status checks.
//
// KV keys:  textbooks:{mediumId}:{classId}
// KV value: { ts: ISO string, textbooks: Textbook[], subjects: Subject[] }

const KERALA = 'https://samagra.kite.kerala.gov.in/v2/api/public/getSubjectTextbooks';
const KV_TTL = 60 * 60 * 24 * 7; // 1 week
const CONCURRENCY = 8;           // parallel fetches to Kerala API

function nowISO() { return new Date().toISOString(); }

/**
 * Fetch one (medium, class) combo, transform, return { mediumId, classId, data }.
 * Returns null if Kerala is unreachable or returns bad data.
 */
async function fetchOne(mediumId, classId) {
  try {
    const res = await fetch(`${KERALA}/${mediumId}/${classId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (samagra-sync)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) { console.warn(`Kerala ${res.status} for ${mediumId}/${classId}`); return null; }
    const body = await res.json();
    if (!body || body.status !== 'success' || !body.data) {
      console.warn(`Kerala bad status for ${mediumId}/${classId}`);
      return null;
    }

    const rawSubjects = Array.isArray(body.data.subjectData) ? body.data.subjectData : [];
    const rawTextbooks = Array.isArray(body.data.textbookData) ? body.data.textbookData : [];

    // Cull orphan subjects (same logic as textbooks.js)
    const visibleSubjectIds = new Set();
    for (const t of rawTextbooks) {
      if (t && t.subjectId != null) visibleSubjectIds.add(Number(t.subjectId));
    }
    const filteredSubjects = rawSubjects.filter(
      (s) => s && s.id != null && visibleSubjectIds.has(Number(s.id))
    );

    // Build subject lookup
    const subjectsById = new Map();
    for (const s of filteredSubjects) {
      if (s && s.id != null) subjectsById.set(Number(s.id), s);
    }

    // Map textbooks
    const textbooks = [];
    for (const t of rawTextbooks) {
      if (!t) continue;
      const subj = subjectsById.get(Number(t.subjectId));
      const sn = subj ? subj.subjectName : null;
      const pdfRel = (t.chapterPdfUrl || '').replace(/^\/+/, '');
      const thumbRel = (t.chapterThumbUrl || '').replace(/^\/+/, '');
      textbooks.push({
        id: Number(t.id),
        chapterName: t.chapterName ?? null,
        mediumId,
        classId,
        subjectId: t.subjectId != null ? Number(t.subjectId) : null,
        pdfUrl: pdfRel ? `/files/${pdfRel}` : null,
        thumbUrl: thumbRel ? `/files/${thumbRel}` : null,
        downloadState: 'complete',
        subjectName: sn,
      });
    }

    return {
      mediumId,
      classId,
      data: {
        textbooks,
        subjects: filteredSubjects.map((s) => ({
          id: Number(s.id),
          subjectName: s.subjectName ?? null,
          subjectGroupId: s.subjectGroupId != null ? Number(s.subjectGroupId) : null,
        })),
        total: textbooks.length,
      },
    };
  } catch (err) {
    console.warn(`Kerala unreachable for ${mediumId}/${classId}: ${err.message}`);
    return null;
  }
}

/**
 * Run a batch of fetches with a concurrency cap.
 */
async function batchRun(tasks, concurrency) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map((fn) => fn()));
    for (const r of chunkResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

export async function onRequest(context) {
  const { request, env } = context;
  const isCron = !!context.cron;

  // Generate all 48 combos: 4 mediums × 12 classes
  const combos = [];
  for (let m = 1; m <= 4; m++) {
    for (let c = 1; c <= 12; c++) {
      combos.push({ mediumId: m, classId: c });
    }
  }

  // For HTTP manual triggers: allow ?medium=2&class=12 to sync a single combo
  const url = new URL(request.url);
  const filterMedium = url.searchParams.get('medium');
  const filterClass = url.searchParams.get('class');

  let tasks;
  if (filterMedium && filterClass) {
    const m = Number(filterMedium), c = Number(filterClass);
    if (m < 1 || m > 4 || c < 1 || c > 12) {
      return Response.json({ error: 'medium 1-4, class 1-12' }, { status: 400 });
    }
    tasks = [() => fetchOne(m, c)];
  } else {
    tasks = combos.map(({ mediumId, classId }) => () => fetchOne(mediumId, classId));
  }

  const started = nowISO();
  const results = await batchRun(tasks, isCron ? CONCURRENCY : 4);

  // Write each result to KV
  let written = 0, failed = 0;
  const writes = [];
  for (const { mediumId, classId, data } of results) {
    const key = `textbooks:${mediumId}:${classId}`;
    const value = JSON.stringify({ ts: nowISO(), ...data });
    writes.push(
      env.TEXTBOOKS_KV.put(key, value, { expirationTtl: KV_TTL })
        .then(() => { written++; })
        .catch((e) => { failed++; console.error(`KV write fail ${key}: ${e.message}`); })
    );
  }
  await Promise.allSettled(writes);

  const status = {
    started,
    finished: nowISO(),
    trigger: isCron ? 'cron' : 'http',
    totalCombos: tasks.length,
    fetched: results.length,
    writtenKV: written,
    kvFailed: failed,
  };

  return Response.json(status);
}
