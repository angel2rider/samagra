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
  },
};

// Compute the list of all (mediumId, classId) pairs
CONFIG.allPairs = CONFIG.mediums.flatMap((m) =>
  CONFIG.classes.map((c) => ({ mediumId: m.id, mediumName: m.name, classId: c.id, className: c.name }))
);

if (typeof module !== 'undefined') {
  module.exports = CONFIG;
}
