// ─── Samagra Textbooks — Shared Configuration ──────────────────────────────

const CONFIG = {
  // Mediums available on Samagra
  mediums: [
    { id: 1, name: 'Malayalam' },
    { id: 2, name: 'English' },
    { id: 3, name: 'Tamil' },
    { id: 4, name: 'Kannada' },
  ],

  // Classes 1 through 12
  classes: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    name: `Class ${i + 1}`,
  })),

  // Samagra API
  api: {
    host: 'samagra.kite.kerala.gov.in',
    basePath: '/v2/api/public/getSubjectTextbooks',
    fileHost: 'samagra.kite.kerala.gov.in',
    filePathBase: '/files/samagra-resource/uploads/tbookscmq',
  },

  // Cloudflare Pages limits
  cloudflare: {
    maxAssetSizeBytes: 24 * 1024 * 1024, // 24 MB (CF Pages max)
    pdfDir: 'pdfs', // relative to website/public/
    dataDir: 'data',
  },

  // GitHub Releases
  github: {
    rawPrefix: 'https://raw.githubusercontent.com',
  },

  // OCI Object Storage
  oci: {
    bucket: 'Kalam',
    namespace: 'ax6entau0azm',
    region: 'ap-hyderabad-1',
    baseUrl: 'https://objectstorage.ap-hyderabad-1.oraclecloud.com/n/ax6entau0azm/b/Kalam/o',
  },

  // Download settings
  download: {
    concurrency: 4,
    retryLimit: 2,
    timeoutMs: 30000,
    minFileSizeBytes: 1000, // skip files smaller than this (corrupted/empty)
  },
};

// Compute the list of all (mediumId, classId) pairs
CONFIG.allPairs = CONFIG.mediums.flatMap((m) =>
  CONFIG.classes.map((c) => ({ mediumId: m.id, mediumName: m.name, classId: c.id, className: c.name }))
);

if (typeof module !== 'undefined') {
  module.exports = CONFIG;
}
