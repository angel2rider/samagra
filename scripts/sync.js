/**
 * scripts/sync.js
 *
 * Local sync script — run this every few months to refresh textbook metadata
 * and download cover thumbnails.
 *
 * Usage:
 *   node scripts/sync.js
 *
 * What it does:
 *   1. Fetches all 48 (4 mediums × 12 classes) combos from Kerala API
 *   2. Downloads each textbook's cover thumbnail from Kerala CDN
 *      → saves to website/public/thumbnails/{relativePath}
 *   3. Rewrites thumbUrl to /thumbnails/... in the metadata
 *   4. Writes combo metadata to Cloudflare KV
 *
 * Prerequisites:
 *   - Node 18+ (for global fetch)
 *   - CLOUDFLARE_API_TOKEN env var set (same token used for wrangler deploy)
 *   - CLOUDFLARE_ACCOUNT_ID env var set
 *   - KV namespace already created (see wrangler.toml)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────
const KERALA_API = 'https://samagra.kite.kerala.gov.in/v2/api/public/getSubjectTextbooks';
const CDN_U2 = 'https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads2/tbookscmq';
const CDN_U1 = 'https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads/tbookscmq';
const THUMBS_DIR = path.resolve(__dirname, '../website/public/thumbnails');
const KV_NAMESPACE_ID = 'b87a8c8dd12e41ecbffab693e17232be';
const KV_BINDING = 'TEXTBOOKS_KV';
const KV_TTL = 60 * 60 * 24 * 7; // 1 week
const CONCURRENCY = 6;
const TOTAL_COMBOS = 48; // 4 mediums × 12 classes

let downloadedThumbs = 0;
let skippedThumbs = 0;
let failedThumbs = 0;

// ── Helpers ───────────────────────────────────────────────────────────

/** Fetch with timeout and retry */
async function fetchRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (samagra-sync)' },
        signal: AbortSignal.timeout(20_000),
      });
      return res;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Download a thumbnail from Kerala CDN to local disk. Returns true on success. */
async function downloadThumb(relativePath) {
  const localPath = path.join(THUMBS_DIR, relativePath);
  if (fs.existsSync(localPath)) {
    skippedThumbs++;
    return true;
  }

  // Try uploads2, then uploads
  for (const base of [CDN_U2, CDN_U1]) {
    try {
      const res = await fetchRetry(`${base}/${relativePath}`);
      if (!res.ok) continue;

      // Ensure directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Write file
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(localPath, buf);
      downloadedThumbs++;
      return true;
    } catch {
      // continue to next CDN base
    }
  }

  failedThumbs++;
  return false;
}

// ── Main sync logic ───────────────────────────────────────────────────

async function fetchCombo(mediumId, classId) {
  console.log(`  Fetching medium=${mediumId} class=${classId}...`);
  try {
    const res = await fetchRetry(`${KERALA_API}/${mediumId}/${classId}`);
    if (!res.ok) {
      console.warn(`    Kerala returned ${res.status}`);
      return null;
    }
    const body = await res.json();
    if (!body || body.status !== 'success' || !body.data) {
      console.warn(`    Bad response status: ${body?.status}`);
      return null;
    }

    const rawSubjects = body.data.subjectData || [];
    const rawTextbooks = body.data.textbookData || [];

    // Cull orphan subjects
    const visibleSubjectIds = new Set();
    for (const t of rawTextbooks) {
      if (t && t.subjectId != null) visibleSubjectIds.add(Number(t.subjectId));
    }
    const filteredSubjects = rawSubjects.filter(
      (s) => s && s.id != null && visibleSubjectIds.has(Number(s.id))
    );

    const subjectsById = new Map();
    for (const s of filteredSubjects) {
      if (s && s.id != null) subjectsById.set(Number(s.id), s);
    }

    // Map textbooks and download thumbnails
    const textbooks = [];
    for (const t of rawTextbooks) {
      if (!t) continue;

      const subj = subjectsById.get(Number(t.subjectId));
      const sn = subj ? subj.subjectName : null;

      const pdfRel = (t.chapterPdfUrl || '').replace(/^\/+/, '');
      const thumbRel = (t.chapterThumbUrl || '').replace(/^\/+/, '');

      // Download thumbnail to local public/thumbnails/
      let thumbUrl = null;
      if (thumbRel) {
        const ok = await downloadThumb(thumbRel);
        if (ok) thumbUrl = `/thumbnails/${thumbRel}`;
      }

      textbooks.push({
        id: Number(t.id),
        chapterName: t.chapterName ?? null,
        mediumId,
        classId,
        subjectId: t.subjectId != null ? Number(t.subjectId) : null,
        pdfUrl: pdfRel ? `/files/${pdfRel}` : null,
        thumbUrl,
        downloadState: 'complete',
        subjectName: sn,
      });
    }

    const ts = new Date().toISOString();
    return {
      mediumId,
      classId,
      data: {
        ts,
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
    console.warn(`    Failed: ${err.message}`);
    return null;
  }
}

/** Build all 48 combos */
function buildCombos() {
  const combos = [];
  for (let m = 1; m <= 4; m++) {
    for (let c = 1; c <= 12; c++) {
      combos.push({ mediumId: m, classId: c });
    }
  }
  return combos;
}

// ── KV upload ─────────────────────────────────────────────────────────

function uploadToKV(bulkEntries) {
  const tmpFile = path.resolve(__dirname, '../.kv-bulk-tmp.json');
  fs.writeFileSync(tmpFile, JSON.stringify(bulkEntries));

  console.log(`\n  Uploading ${bulkEntries.length} keys to KV...`);
  try {
    execSync(
      `npx wrangler kv bulk put ${tmpFile} --binding=${KV_BINDING} --namespace-id=${KV_NAMESPACE_ID}`,
      {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        env: { ...process.env },
      }
    );
    console.log('  KV upload complete.');
  } catch (err) {
    console.error('  KV upload failed, bulk file saved at:', tmpFile);
    console.error('  Run manually: npx wrangler kv bulk put .kv-bulk-tmp.json --binding=TEXTBOOKS_KV');
    throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Entry point ───────────────────────────────────────────────────────

async function main() {
  // Validate environment
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    console.error('Missing required environment variables.');
    console.error('  Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID before running.');
    console.error('  These are the same variables used for wrangler deploy.');
    process.exit(1);
  }
  console.log('Samagra Textbooks — Local Sync');
  console.log('==============================\n');

  // Ensure thumbnails directory exists
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const combos = buildCombos();
  console.log(`Syncing ${combos.length} medium×class combos...\n`);

  // Process in concurrent batches
  const results = [];
  for (let i = 0; i < combos.length; i += CONCURRENCY) {
    const chunk = combos.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(
      chunk.map(({ mediumId, classId }) => fetchCombo(mediumId, classId))
    );
    for (const r of chunkResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
    const done = Math.min(i + CONCURRENCY, combos.length);
    console.log(`  Progress: ${done}/${combos.length} combos processed`);
  }

  // Build KV bulk entries
  const bulkEntries = [];
  for (const { mediumId, classId, data } of results) {
    bulkEntries.push({
      key: `textbooks:${mediumId}:${classId}`,
      value: JSON.stringify(data),
      expiration_ttl: KV_TTL,
    });
  }

  // Upload to KV
  if (bulkEntries.length > 0) {
    uploadToKV(bulkEntries);
  }

  // Summary
  console.log('\n=== Sync Complete ===');
  console.log(`  Combos fetched:  ${results.length}/${combos.length}`);
  console.log(`  Thumbnails:      ${downloadedThumbs} downloaded, ${skippedThumbs} skipped (cached), ${failedThumbs} failed`);
  console.log(`  KV keys written: ${bulkEntries.length}`);
  console.log('\nNext step: commit website/public/thumbnails/ and deploy.');
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
