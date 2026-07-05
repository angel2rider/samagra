# 📚 Samagra — SCERT Kerala Textbook Browser

Browse **SCERT Kerala (Samagra) textbooks** online through an interactive radial curriculum selector. No login, no app install — just open the page, pick a language → class → subject, and read.

🌐 **Live:** [samagra.msedge.lol](https://samagra.msedge.lol)

> ⚠️ **Unofficial mirror.** All content belongs to SCERT Kerala / Samagra KITE ([samagra.kite.kerala.gov.in](https://samagra.kite.kerala.gov.in)). This project exists to make their public textbooks easier to browse.

---

## ✨ Features

- **Radial curriculum selector** — drag-to-rotate 3 concentric rings (Language → Class → Subject)
- **Built-in PDF viewer** — read any textbook in-browser, no download needed
- **Full archive** — Kerala textbooks across **4 languages × 12 classes** mirrored into a free CDN tier
- **Smart caching** — Cold-visits hit the Cloudflare edge; subsequent fetches served from cache
- **Keyboard & touch** — mouse drag, scroll-wheel, or tap any item to navigate

---

## 🏗️ Architecture

```
Samagra KITE API
        │
        ▼
   VPS crawler                       ← downloads all textbooks once
        │
        ├── files < 24 MB   ──►  Cloudflare Pages (CDN)
        └── files ≥ 24 MB   ──►  GitHub Releases (raw.githubusercontent.com)
                                        │
   Browser  ◄────  Cloudflare Pages Functions  ◄────┘
                    ├── /api/textbooks       (D1 database)
                    ├── /api/stats           (live counters)
                    └── /files/*             (CSP-stripping proxy)
```

- **Frontend** — React 18 + Vite + TypeScript, lazy-loaded curriculum selector (Framer Motion split into its own chunk)
- **API** — Cloudflare Pages Functions (Workers); D1 database holds textbook metadata
- **Files** — A `/files/*` Pages Function proxies the underlying CDN, strips `x-frame-options` / CSP `frame-ancestors`, and forces `Content-Disposition: inline` so PDFs can be embedded in the in-browser viewer
- **Hosting** — Cloudflare Pages + GitHub Releases (free for this size of public-good archive)

---

## 💻 Local development

```bash
# 1. install
npm install
cd website && npm install

# 2. type-check + dev server
cd website
npm run tsc -- --noEmit       # type-check only
npm run dev                  # vite dev server on :5173

# 3. production build
npm run build                # outputs website/dist/

# 4. deploy (requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars)
cd ..
npm run deploy
```

---

## 📁 Project layout

| Path | What it does |
|---|---|
| `website/src/` | React app — `App.tsx`, `CurriculumSelector.tsx`, `Ring.tsx`, `RadialSelector.tsx`, `api.ts` |
| `website/public/viewer/` | Standalone PDF reader page |
| `website/migrations/` | D1 SQL schema |
| `functions/` | Cloudflare Pages Functions (API + files proxy) |
| `scripts/` | VPS helpers — download, process-file-size partitioning, deploy-to-CF, deploy-to-GitHub, resolve GitHub URLs |
| `config.js` | Shared constants: medium IDs, class range, API base, CDN limits |
| `wrangler.toml` | Cloudflare Pages project name + build-output dir |
| `package.json` | Root scripts (`dev`, `build`, `deploy`) |

---

## 🎯 The radial selector

Three rings, each rotatable independently:

| Ring | Radius | Items | Interaction |
|---|---|---|---|
| **Inner** | Language | Malayalam · English · Tamil · Kannada | drag, scroll, click |
| **Middle** | Class | 1 – 12 | drag, scroll, click |
| **Outer** | Subject | filtered per medium + class | drag, scroll, click |

Each ring has momentum snap — let go and it settles on the nearest item. The full bundle ships at **~64 KB gzipped** of initial JS (the motion library is code-split into a separate chunk).

---

## ⚡ Performance notes

A few things keep this snappy on a cold visit:

- Splash logo served as **10 KB WebP** (down from 2.1 MB PNG) with PNG fallback
- Initial `/api/textbooks` call is **preloaded** while HTML parses
- `content-visibility: auto` on cards skips off-screen rendering
- Adjacent class data is **prefetched** so spinning the wheel cold-starts the next fetch
- `/files/*` responses cached at Cloudflare's edge with `Cache-Control: public, max-age=86400, immutable`

---

## 📜 License & attribution

- **Code** in this repository: open-source. See `LICENSE` (add one if you intend this to be public).
- **Book content**: © SCERT Kerala. The PDFs and thumbnails belong to Samagra KITE; this project just provides a faster reader UI over the public [Samagra KITE platform](https://samagra.kite.kerala.gov.in).
