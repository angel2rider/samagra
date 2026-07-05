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

A thin Cloudflare Pages layer that fronts the public Samagra KITE API and
strips the embedding restrictions so textbooks can be read in-browser.

```
   Browser
     │
     ▼
   Cloudflare Pages
     ├── /api/textbooks   ──►  Kerala API (1h edge cache)
     ├── /api/stats       ──►  Kerala API (cached, stale‑while‑revalidate)
     └── /files/*         ──►  Kerala CDN (24h edge cache, CSP-stripped)
```

- **Frontend** — React 18 + Vite + TypeScript. The 3-ring radial selector and motion library are split into their own chunk so the nav bar renders before the rings finish loading.
- **`/api/textbooks`** — Pages Function that fetches Kerala's `getSubjectTextbooks/{medium}/{class}` endpoint, joins subjects, culls orphans (Kerala returns ~40 subjects per request regardless of medium), and filters by subject/search. Cache API at the edge, `max-age=3600`.
- **`/files/*`** — Pages Function that proxies PDFs and thumbnails from `samagra.kite.kerala.gov.in` (tries `uploads2/` then falls back to `uploads/`). It strips `content-security-policy`, `x-frame-options`, and `x-content-type-options`, and forces `Content-Disposition: inline` on PDFs so the in-browser viewer can iframe-embed them — Kerala's own server blocks cross-origin embedding otherwise. `Cache-Control: public, max-age=86400, immutable`.
- **Hosting** — Cloudflare Pages only. Both `functions/api/*` and `functions/files/*` are deployed automatically from the repo.

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
| `website/public/viewer/` | Standalone PDF reader page (served at `/viewer/`) |
| `website/migrations/` | D1 SQL schema (legacy; the running API uses a live Kerala proxy, not D1) |
| `functions/api/` | Cloudflare Pages Function for `/api/textbooks` and `/api/stats` |
| `functions/files/` | Cloudflare Pages Function for `/files/*` — Kerala CDN proxy with CSP stripped |
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

- Splash logo is a small WebP (~10 KB in current build) with a PNG `onerror` fallback
- The first `/api/textbooks` call is `<link rel="preload">`'d while HTML parses
- `content-visibility: auto` on cards skips off-screen rendering
- Adjacent class data is **prefetched** so spinning the wheel cold-starts the next fetch
- `/files/*` responses cached at Cloudflare's edge with `Cache-Control: public, max-age=86400, immutable`

---

## 📜 License & attribution

- **Code** in this repository: MIT — see [`LICENSE`](./LICENSE).
- **Book content**: © SCERT Kerala. The PDFs and thumbnails belong to Samagra KITE; this repository just provides a faster reader UI over the public [Samagra KITE platform](https://samagra.kite.kerala.gov.in).
