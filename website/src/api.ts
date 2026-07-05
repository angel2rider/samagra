export interface Textbook {
  id: number
  chapterName: string
  mediumId: number
  classId: number
  subjectId: number
  pdfUrl: string
  thumbUrl: string
  downloadState: string
  subjectName: string
}

export interface Subject {
  id: number
  subjectName: string
  subjectGroupId: number
}

export interface TextbooksResponse {
  textbooks: Textbook[]
  subjects: Subject[]
  total: number
  mediumId: number
  classId: number
}

export const MEDIUMS = [
  { id: 1, name: 'Malayalam' },
  { id: 2, name: 'English' },
  { id: 3, name: 'Tamil' },
  { id: 4, name: 'Kannada' },
]

export const CLASSES = Array.from({ length: 12 }, (_, i) => (i + 1).toString())

export function getMediumId(name: string): number {
  return MEDIUMS.find(m => m.name === name)?.id ?? 2
}

export function getClassId(name: string): number {
  const n = parseInt(name)
  return isNaN(n) ? 12 : n
}

export function displayName(book: Textbook): string {
  const n = book.chapterName
  if (n && n !== 'Untitled' && n.trim()) return n
  return (book.subjectName || 'Textbook') + ' Textbook'
}

export function viewerUrl(book: Textbook): string {
  if (!book || !book.pdfUrl) return '#'
  return `/viewer/?url=${encodeURIComponent(book.pdfUrl)}&title=${encodeURIComponent(displayName(book))}`
}

/** Full relative path after /files/ prefix (preserves directory structure) */
function pdfPath(book: Textbook): string {
  return (book.pdfUrl || '').replace(/^\/files\//, '')
}

export function fileName(book: Textbook): string {
  const path = pdfPath(book)
  const parts = path.split('/')
  return parts[parts.length - 1] || 'textbook.pdf'
}

/** Direct Kerala CDN URL — bypasses our Cloudflare proxy for full-speed loading */
export function directPdfUrl(book: Textbook): string {
  const path = pdfPath(book)
  return `https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads2/tbookscmq/${path}`
}

export async function fetchTextbooks(mediumId: number, classId: number, search?: string): Promise<TextbooksResponse> {
  const params = new URLSearchParams({ medium: String(mediumId), class: String(classId) })
  if (search?.trim()) params.set('search', search.trim())
  const res = await fetch(`/api/textbooks?${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const ALL_SUBJECTS_FALLBACK = [
  'Mathematics', 'Physics', 'Chemistry', 'Biology',
  'History', 'Geography', 'Civics', 'Economics',
  'Computer Science', 'English Lit.', 'Accountancy',
  'Business Studies', 'Psychology', 'Sociology',
  'Art & Design', 'Physical Ed.',
]

export function getFilteredSubjects(subjectsApi: Subject[], search: string): string[] {
  const pool = subjectsApi.length > 0 ? subjectsApi.map(s => s.subjectName) : ALL_SUBJECTS_FALLBACK
  if (!search.trim()) return pool
  const q = search.toLowerCase()
  return pool.filter(s => s.toLowerCase().includes(q))
}

export async function fetchStats(): Promise<{ totalComplete: number } | null> {
  try {
    const res = await fetch('/api/stats')
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}
