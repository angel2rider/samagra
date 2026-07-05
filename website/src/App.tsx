import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { fetchTextbooks,
  fetchStats,
  MEDIUMS,
  CLASSES,
  getMediumId,
  getClassId,
  viewerUrl,
  directPdfUrl,
  displayName,
  fileName,
  type Textbook,
} from './api'
import type { CurriculumSelection } from './CurriculumSelector'

function readSaved(): { lang: string; cls: string; subj: string | null } {
  try {
    const raw = sessionStorage.getItem('samagra-selection')
    return raw ? JSON.parse(raw) : { lang: MEDIUMS[0].name, cls: '1', subj: null }
  } catch {
    return { lang: MEDIUMS[0].name, cls: '1', subj: null }
  }
}

const CurriculumSelector = lazy(() => import('./CurriculumSelector'))

export default function App() {
  // Seed initial display from sessionStorage so subtitle/textbook count
  // look right while the wheel loads, but the wheel drives all fetches.
  const saved = useRef(readSaved())

  const [selLang, setSelLang] = useState(saved.current.lang)
  const [selClass, setSelClass] = useState(saved.current.cls)
  const [selSubj, setSelSubj] = useState<string | null>(saved.current.subj)
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [subjectsApi, setSubjectsApi] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<string>('')
  const mountTime = useRef(Date.now())
  const MIN_SPLASH_MS = 500
  // Refs for latest state — avoids stale closures in handleSelectionChange
  const selLangRef = useRef(saved.current.lang)
  const selClassRef = useRef(saved.current.cls)
  selLangRef.current = selLang
  selClassRef.current = selClass

  const fetchData = useCallback(async (lang: string, cls: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchTextbooks(getMediumId(lang), getClassId(cls))
      setTextbooks(data.textbooks)
      setSubjectsApi(data.subjects.map((s) => s.subjectName))
      setIsLoading(false)

      // Prefetch adjacent class data so wheel-spinning feels instant
      // Clean up previous prefetch links first to avoid DOM leaks
      const prev = document.querySelectorAll('link[data-prefetch-adjacent]')
      prev.forEach((l) => l.remove())
      const currentClass = parseInt(cls)
      const nextClass = Math.min(currentClass + 1, 12)
      const prevClass = Math.max(currentClass - 1, 1)
      for (const c of [nextClass, prevClass]) {
        if (c !== currentClass) {
          const url = `/api/textbooks?medium=${getMediumId(lang)}&class=${c}`
          const link = document.createElement('link')
          link.rel = 'prefetch'
          link.href = url
          link.as = 'fetch'
          link.crossOrigin = 'anonymous'
          link.dataset.prefetchAdjacent = 'true'
          document.head.appendChild(link)
        }
      }
    } catch (err: any) {
      setError(err.message)
      setIsLoading(false)
    }
  }, [])

  // If the user is returning via browser back button, sessionStorage holds
  // their previous selection — fetch it immediately so the grid is populated
  // before the wheel even fires its first onChange.
  useEffect(() => {
    fetchStats().then((s) => {
      if (s?.totalComplete) setStats(`${s.totalComplete} textbooks`)
    })
    const saved = readSaved()
    // Only auto-fetch if the saved selection differs from the default
    // (Malayalam, Class 1, no subject). The default case is handled by the
    // wheel's first onChange like a fresh visit.
    if (saved.lang !== MEDIUMS[0].name || saved.cls !== '1') {
      const key = `${saved.lang}::${saved.cls}`
      lastFetchKeyRef.current = key
      firstFetchDone.current = true
      fetchData(saved.lang, saved.cls)
    }
  }, [])

  // Hide the HTML splash once data loads and the wheel has initialised
  const firstFetchDone = useRef(false)
  useEffect(() => {
    if (!isLoading && firstFetchDone.current) {
      const el = document.getElementById('splash-html')
      if (!el) return
      const elapsed = Date.now() - mountTime.current
      const delay = Math.max(elapsed >= MIN_SPLASH_MS ? 200 : MIN_SPLASH_MS - elapsed + 200, 0)
      const t = setTimeout(() => el.classList.add('splash-html--hidden'), delay)
      return () => clearTimeout(t)
    }
  }, [isLoading])

  // Wheel → app state. The wheel drives everything — no initial fetch, no skip guards.
  const lastFetchKeyRef = useRef<string>('')
  const handleSelectionChange = useCallback(
    (sel: CurriculumSelection) => {
      const langChanged = sel.language !== selLangRef.current
      const classChanged = sel.classLabel !== selClassRef.current
      setSelLang(sel.language)
      setSelClass(sel.classLabel)
      setSelSubj(sel.subject || null)
      // Save selection so it survives navigation to the viewer and back
      try {
        sessionStorage.setItem('samagra-selection', JSON.stringify({
          lang: sel.language, cls: sel.classLabel, subj: sel.subject || null
        }))
      } catch { /* quota exceeded — ignore */ }
      if (langChanged || classChanged) {
        const key = `${sel.language}::${sel.classLabel}`
        if (lastFetchKeyRef.current !== key) {
          lastFetchKeyRef.current = key
          fetchData(sel.language, sel.classLabel)
        }
      }
    },
    [fetchData],
  )

  // Filtering is client-side: subject pickList narrows textbook grid instantly.
  const filteredBooks = useMemo(() => {
    if (!selSubj) return textbooks
    return textbooks.filter((b: Textbook) => b.subjectName === selSubj)
  }, [textbooks, selSubj])

  // While the catalog is empty (loading OR the API returned zero subjects),
  // feed CurriculumSelector 12 ellipsis placeholders so the dial structure is
  // visible. Memoized to avoid creating a new array reference on every render
  // (which would force CurriculumSelector to re-render unnecessarily).
  const loadingPlaceholders = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `Loading subject ${i + 1}`),
    []
  )
  const subjectsForWheel =
    subjectsApi.length > 0
      ? subjectsApi
      : loadingPlaceholders

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>

      <div className="bg-layers" aria-hidden="true">
        <div className="bg-glow-green" />
        <div className="bg-glow-gold" />
        <div className="bg-noise" />
        <div className="bg-vignette" />
      </div>

      {/* Kasavu border — traditional Kerala gold-thread motif */}
      <div className="kasavu-border" aria-hidden="true">
        <div className="kasavu-border__pattern" />
        <div className="kasavu-border__gold" />
      </div>

      <nav className="nav" role="navigation" aria-label="Main navigation">
        <div className="nav-inner">
          <div className="nav-left">
            <a href="/" className="nav-logo" aria-label="Samagra Textbooks — Home">
              <span className="logo-ml">സമഗ്ര</span>
              <span className="logo-en">
                Samagra <span className="logo-a">Textbooks</span>
              </span>
            </a>
          </div>
          <div className="nav-right">
            <span className="stats-pill" aria-live="polite">
              {stats || <span className="pulse-dot" />}
            </span>
          </div>
        </div>
      </nav>

      <main id="main-content">
        <div className="selector-panel">
          <Suspense fallback={<div style={{height:500}} />}>
            <CurriculumSelector
              languages={MEDIUMS.map((m) => m.name)}
              classes={CLASSES.map(String)}
              subjects={subjectsForWheel}
              initialSelection={{
                language: saved.current.lang,
                classLabel: saved.current.cls,
                subject: saved.current.subj ?? undefined,
              }}
              onChange={(sel) => {
                // First selection always triggers the initial fetch.
                // Pre-set lastFetchKeyRef so handleSelectionChange skips the duplicate.
                if (!firstFetchDone.current) {
                  firstFetchDone.current = true
                  const key = `${sel.language}::${sel.classLabel}`
                  lastFetchKeyRef.current = key
                  fetchData(sel.language, sel.classLabel)
                }
                handleSelectionChange(sel)
              }}
            />
          </Suspense>
        </div>

        <div className="books-panel">
          <div className="books-panel-header">
            <div>
              <h2 className="books-title">Textbooks</h2>
              <p className="books-sub" id="books-subtitle">
                {isLoading
                  ? 'Loading…'
                  : `Showing ${[selLang, `Class ${selClass}`, selSubj].filter(Boolean).join(' · ')}`}
              </p>
            </div>
            <span className="books-count" id="books-count">
              {isLoading ? '' : `${filteredBooks.length} textbook${filteredBooks.length !== 1 ? 's' : ''}`}
            </span>
          </div>

          {isLoading && (
            <div className="skeleton-grid" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="skel" />
              ))}
            </div>
          )}

          {error && !isLoading && (
            <div className="state state-error" role="alert">
              <svg className="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h2>Something went wrong</h2>
              <p id="error-text">{error}</p>
            </div>
          )}

          {!isLoading && !error && filteredBooks.length === 0 && (
            <div className="state" role="status">
              <svg className="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <path d="M14 8h-4" />
                <path d="M12 6v4" />
              </svg>
              <h2>No textbooks found</h2>
              <p>Try changing the medium, class, or subject selection.</p>
            </div>
          )}

          {!isLoading && !error && filteredBooks.length > 0 && (
            <ul className="card-grid" aria-label="Textbooks">
              {filteredBooks.map((book: Textbook, i: number) => (
                <li
                  key={book.id}
                  className="card"
                  tabIndex={0}
                  style={{ animationDelay: `${600 + Math.min(i * 50, 500)}ms` }}
                  onClick={() => (window.location.href = viewerUrl(book))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      window.location.href = viewerUrl(book)
                    }
                  }}
                >
                  <div className="card-cover">
                    <img
                      src={book.thumbUrl || '/hero-bg.png'}
                      alt={displayName(book)}
                      width="300"
                      height="400"
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).src = '/hero-bg.png'
                      }}
                    />
                    <div className="card-overlay">
                      <span className="card-lang">{selLang}</span>
                      <span className="card-subj">{book.subjectName}</span>
                      <h2 className="card-name">{displayName(book)}</h2>
                    </div>
                  </div>
                  <div className="card-dl">
                    <a
                      href={viewerUrl(book)}
                      className="dl-btn"
                      aria-label={`Preview ${displayName(book)}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </a>
                    <a
                      href={directPdfUrl(book)}
                      className="dl-btn"
                      aria-label={`Download ${displayName(book)}`}
                      download={fileName(book)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginLeft: 4 }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <footer className="footer-panel">
        <p>
          All textbooks &copy; SCERT Kerala. Data from{' '}
          <a href="https://samagra.kite.kerala.gov.in/" target="_blank" rel="noopener">
            Samagra KITE Kerala
          </a>
          . Unofficial mirror.
        </p>
      </footer>
    </>
  )
}
