/**
 * MobileSelector — Native-app feeling three-step selection flow
 * ---------------------------------------------------------------
 * Language → Class → Subject → Results
 *
 * State machine driven. Spring animations via motion/react.
 * Only calls onChange when all three selections are complete.
 * Desktop radial selector is completely untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { fetchTextbooks, getMediumId, getClassId, MEDIUMS, CLASSES } from './api'
import type { CurriculumSelection } from './CurriculumSelector'

/* ============================ Types ============================ */
type Step = 'language' | 'class' | 'subject' | 'results'

type Direction = 'forward' | 'backward'

interface MobileSelectorProps {
  onChange?: (selection: CurriculumSelection) => void
  onStepChange?: (step: Step) => void
}

/* ============================ Spring config ============================ */
const STEP_TRANSITION = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 34,
  mass: 0.9,
}

const CARD_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 28,
}

const PILL_SPRING = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 30,
}

/* ============================ Language data ============================ */
const LANGUAGE_META: Record<string, { label: string; initial: string; script: string; color: string; bg: string; gradient: string }> = {
  English:   { label: 'English',   initial: 'E', script: 'English',   color: '#1a3a5c', bg: '#e8f0f8', gradient: 'linear-gradient(135deg, #e8f0f8 0%, #d0e0f0 100%)' },
  Malayalam: { label: 'മലയാളം',   initial: 'മ', script: 'Malayalam', color: '#1E5631', bg: '#e8f3e8', gradient: 'linear-gradient(135deg, #e8f3e8 0%, #d0e8d0 100%)' },
  Tamil:     { label: 'தமிழ்',     initial: 'த', script: 'Tamil',     color: '#5c2d1a', bg: '#f5e8e0', gradient: 'linear-gradient(135deg, #f5e8e0 0%, #ecd8cc 100%)' },
  Kannada:   { label: 'ಕನ್ನಡ',    initial: 'ಕ', script: 'Kannada',   color: '#4a1a5c', bg: '#f0e8f5', gradient: 'linear-gradient(135deg, #f0e8f5 0%, #e4d8f0 100%)' },
}

/* ============================ Step title ============================ */
function stepTitle(step: Step): string {
  switch (step) {
    case 'language': return 'Choose a language'
    case 'class':    return 'Pick your class'
    case 'subject':  return 'Select a subject'
    case 'results':  return ''
  }
}

function stepSubtitle(step: Step): string {
  switch (step) {
    case 'language': return 'Tap one to continue'
    case 'class':    return 'Tap your class number'
    case 'subject':  return 'Tap a subject or search'
    case 'results':  return ''
  }
}

/* ============================ Selection Pill ============================ */
function SelectionPill({
  label,
  color,
  delay,
  onClick,
  editable,
}: {
  label: string
  color: string
  delay?: number
  onClick?: () => void
  editable?: boolean
}) {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.6, y: -12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6, y: -12 }}
      transition={{ ...PILL_SPRING, delay: delay ?? 0 }}
      type="button"
      onClick={onClick}
      className={`ms-pill ${editable ? 'ms-pill--editable' : ''}`}
      style={{ '--pill-color': color } as React.CSSProperties}
    >
      <span className="ms-pill-dot" style={{ background: color }} />
      {label}
      {editable && (
        <svg className="ms-pill-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      )}
    </motion.button>
  )
}

/* ============================ Main Component ============================ */
export default function MobileSelector({
  onChange,
  onStepChange,
}: MobileSelectorProps) {
  const [step, setStep] = useState<Step>('language')
  const [direction, setDirection] = useState<Direction>('forward')

  const [language, setLanguage] = useState<string | null>(null)
  const [classLabel, setClassLabel] = useState<string | null>(null)
  const [subject, setSubject] = useState<string | null>(null)

  const [availableSubjects, setAvailableSubjects] = useState<string[]>([])
  const [subjectLoading, setSubjectLoading] = useState(false)
  const [subjectQuery, setSubjectQuery] = useState('')
  const [subjectError, setSubjectError] = useState<string | null>(null)

  // Ref to track if we've already completed once (for re-opening selector)
  const hasCompleted = useRef(false)

  // Notify parent of step changes
  useEffect(() => {
    onStepChange?.(step)
  }, [step])

  /* ── Step navigation ── */
  const goForward = useCallback((nextStep: Step) => {
    setDirection('forward')
    setStep(nextStep)
  }, [])

  const goBack = useCallback(() => {
    setDirection('backward')
    setStep((prev) => {
      switch (prev) {
        case 'class': return 'language'
        case 'subject': return 'class'
        case 'results': return 'subject'
        default: return prev
      }
    })
  }, [])

  /* ── Language selection ── */
  const selectLanguage = useCallback((lang: string) => {
    setLanguage(lang)
    setClassLabel(null)
    setSubject(null)
    setAvailableSubjects([])
    setSubjectQuery('')
    goForward('class')
  }, [goForward])

  /* ── Class selection ── */
  const selectClass = useCallback(async (cls: string) => {
    setClassLabel(cls)
    setSubject(null)
    setSubjectQuery('')
    setSubjectError(null)
    goForward('subject')

    // Fetch subjects for this language + class
    if (!language) return
    setSubjectLoading(true)
    try {
      const data = await fetchTextbooks(getMediumId(language), getClassId(cls))
      const names = data.subjects.map((s) => s.subjectName)
      setAvailableSubjects(names)
      setSubjectLoading(false)
    } catch (err: any) {
      setSubjectError(err.message || 'Failed to load subjects')
      setSubjectLoading(false)
      setAvailableSubjects([])
    }
  }, [language, goForward])

  /* ── Subject selection ── */
  const selectSubject = useCallback((subj: string) => {
    setSubject(subj)
    hasCompleted.current = true
    goForward('results')
    if (language && classLabel) {
      onChange?.({ language, classLabel, subject: subj })
    }
  }, [language, classLabel, onChange, goForward])

  /* ── Restart / change selection ── */
  const resetToLanguage = useCallback(() => {
    setLanguage(null)
    setClassLabel(null)
    setSubject(null)
    setAvailableSubjects([])
    setSubjectQuery('')
    setDirection('backward')
    setStep('language')
  }, [])

  const resetToClass = useCallback(() => {
    setClassLabel(null)
    setSubject(null)
    setSubjectQuery('')
    setDirection('backward')
    setStep('class')
  }, [])

  const resetToSubject = useCallback(() => {
    setSubject(null)
    setSubjectQuery('')
    setDirection('backward')
    setStep('subject')
  }, [])

  /* ── Mobile always starts fresh at language step ── */
  useEffect(() => {
    // Ignore any saved sessionStorage state on mobile — always start the flow fresh.
    // This ensures a consistent native-app onboarding experience.
    setLanguage(null)
    setClassLabel(null)
    setSubject(null)
    setAvailableSubjects([])
    setSubjectQuery('')
    setStep('language')
    hasCompleted.current = false
  }, [])

  /* ── Filtered subjects ── */
  const filteredSubjects = useMemo(() => {
    if (!subjectQuery.trim()) return availableSubjects
    const q = subjectQuery.toLowerCase()
    return availableSubjects.filter((s) => s.toLowerCase().includes(q))
  }, [availableSubjects, subjectQuery])

  /* ── Animation variants ── */
  const stepVariants = useMemo(() => ({
    enter: (dir: Direction) => ({
      x: dir === 'forward' ? '100%' : '-100%',
      opacity: 0,
      scale: 0.96,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (dir: Direction) => ({
      x: dir === 'forward' ? '-60%' : '60%',
      opacity: 0,
      scale: 0.96,
    }),
  }), [])

  const cardContainerVariants = {
    hidden: {},
    show: {
      transition: { staggerChildren: 0.04, delayChildren: 0.05 },
    },
  }

  const cardItemVariants = {
    hidden: { opacity: 0, y: 28, scale: 0.94 },
    show: { opacity: 1, y: 0, scale: 1, transition: CARD_SPRING },
  }

  /* ── Render ── */
  const showPills = step !== 'language' || language !== null
  const canGoBack = step !== 'language' && step !== 'results'

  return (
    <div className={`ms-root ${step === 'results' ? 'ms-root--results' : ''}`}>
      {/* ── Header: back button + pills ── */}
      <div className="ms-header">
        <AnimatePresence mode="popLayout">
          {canGoBack && (
            <motion.button
              key="back"
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={PILL_SPRING}
              type="button"
              className="ms-back-btn"
              onClick={goBack}
              aria-label="Go back"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>

        <div className="ms-pills-row">
          <AnimatePresence mode="popLayout">
            {language && (
              <SelectionPill
                key="pill-lang"
                label={language}
                color={LANGUAGE_META[language]?.color ?? '#1E5631'}
                delay={0}
                onClick={step === 'results' ? resetToLanguage : undefined}
                editable={step === 'results'}
              />
            )}
            {classLabel && (
              <SelectionPill
                key="pill-class"
                label={`Class ${classLabel}`}
                color="#3a2c1c"
                delay={0.04}
                onClick={step === 'results' ? resetToClass : undefined}
                editable={step === 'results'}
              />
            )}
            {subject && (
              <SelectionPill
                key="pill-subj"
                label={subject}
                color="#a97e22"
                delay={0.08}
                onClick={step === 'results' ? resetToSubject : undefined}
                editable={step === 'results'}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Step title ── */}
      <AnimatePresence mode="wait">
        {step !== 'results' && (
          <motion.div
            key={`title-${step}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="ms-title-block"
          >
            <h2 className="ms-title">{stepTitle(step)}</h2>
            <p className="ms-subtitle">{stepSubtitle(step)}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Step content ── */}
      <div className="ms-stage">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          {/* -------- Language Step -------- */}
          {step === 'language' && (
            <motion.div
              key="language"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={STEP_TRANSITION}
              className="ms-step"
            >
              <motion.div
                className="ms-lang-grid"
                variants={cardContainerVariants}
                initial="hidden"
                animate="show"
              >
                {MEDIUMS.map((m) => {
                  const meta = LANGUAGE_META[m.name]
                  const isSel = language === m.name
                  return (
                    <motion.button
                      key={m.name}
                      variants={cardItemVariants}
                      type="button"
                      className={`ms-lang-card ${isSel ? 'ms-lang-card--selected' : ''}`}
                      onClick={() => selectLanguage(m.name)}
                      onPointerDown={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const x = ((e.clientX - rect.left) / rect.width) * 100
                        const y = ((e.clientY - rect.top) / rect.height) * 100
                        ;(e.currentTarget as HTMLElement).style.setProperty('--tap-x', `${x}%`)
                        ;(e.currentTarget as HTMLElement).style.setProperty('--tap-y', `${y}%`)
                      }}
                      whileTap={{ scale: 0.96 }}
                      style={{
                        '--lang-color': meta?.color ?? '#1E5631',
                        '--lang-bg': meta?.bg ?? '#e8f3e8',
                        '--lang-gradient': meta?.gradient ?? 'linear-gradient(135deg, #e8f3e8, #d0e8d0)',
                      } as React.CSSProperties}
                    >
                      <span className="ms-lang-initial">{meta?.initial}</span>
                      <span className="ms-lang-script">{meta?.script}</span>
                      <span className="ms-lang-label">{meta?.label ?? m.name}</span>
                    </motion.button>
                  )
                })}
              </motion.div>
            </motion.div>
          )}

          {/* -------- Class Step -------- */}
          {step === 'class' && (
            <motion.div
              key="class"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={STEP_TRANSITION}
              className="ms-step"
            >
              <motion.div
                className="ms-class-grid"
                variants={cardContainerVariants}
                initial="hidden"
                animate="show"
              >
                {CLASSES.map((c) => {
                  const isSel = classLabel === c
                  return (
                    <motion.button
                      key={c}
                      variants={cardItemVariants}
                      type="button"
                      className={`ms-class-btn ${isSel ? 'ms-class-btn--selected' : ''}`}
                      onClick={() => selectClass(c)}
                      onPointerDown={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const x = ((e.clientX - rect.left) / rect.width) * 100
                        const y = ((e.clientY - rect.top) / rect.height) * 100
                        ;(e.currentTarget as HTMLElement).style.setProperty('--tap-x', `${x}%`)
                        ;(e.currentTarget as HTMLElement).style.setProperty('--tap-y', `${y}%`)
                      }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <span className="ms-class-num">{c}</span>
                    </motion.button>
                  )
                })}
              </motion.div>
            </motion.div>
          )}

          {/* -------- Subject Step -------- */}
          {step === 'subject' && (
            <motion.div
              key="subject"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={STEP_TRANSITION}
              className="ms-step"
            >
              {/* Search */}
              <motion.div
                className="ms-search-box"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, ...PILL_SPRING }}
              >
                <svg className="ms-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={subjectQuery}
                  onChange={(e) => setSubjectQuery(e.target.value)}
                  placeholder="Search subjects…"
                  className="ms-search-input"
                  aria-label="Search subjects"
                />
                {subjectQuery && (
                  <button
                    type="button"
                    className="ms-search-clear"
                    onClick={() => setSubjectQuery('')}
                    aria-label="Clear search"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </motion.div>

              {/* Loading / Error / Grid */}
              {subjectLoading && (
                <div className="ms-loading">
                  <div className="ms-spinner" />
                  <p>Loading subjects…</p>
                </div>
              )}

              {subjectError && !subjectLoading && (
                <div className="ms-error">
                  <p>{subjectError}</p>
                  <button
                    type="button"
                    className="ms-retry-btn"
                    onClick={() => {
                      if (language && classLabel) {
                        setSubjectError(null)
                        selectClass(classLabel)
                      }
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!subjectLoading && !subjectError && (
                <motion.div
                  className="ms-subject-list"
                  variants={cardContainerVariants}
                  initial="hidden"
                  animate="show"
                >
                  {filteredSubjects.length === 0 && availableSubjects.length > 0 && (
                    <p className="ms-empty">No subjects match "{subjectQuery}"</p>
                  )}
                  {availableSubjects.length === 0 && (
                    <p className="ms-empty">No subjects found</p>
                  )}
                  {filteredSubjects.map((s) => (
                    <motion.button
                      key={s}
                      variants={cardItemVariants}
                      type="button"
                      className="ms-subject-card"
                      onClick={() => selectSubject(s)}
                      whileTap={{ scale: 0.97 }}
                    >
                      <span className="ms-subject-name">{s}</span>
                      <svg className="ms-subject-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Progress dots ── */}
      {step !== 'results' && (
        <div className="ms-progress">
          {(['language', 'class', 'subject'] as Step[]).map((s, i) => {
            const isActive = s === step
            const isDone =
              (s === 'language' && language !== null) ||
              (s === 'class' && classLabel !== null) ||
              (s === 'subject' && subject !== null)
            return (
              <motion.div
                key={s}
                className={`ms-dot ${isActive ? 'ms-dot--active' : ''} ${isDone ? 'ms-dot--done' : ''}`}
                animate={{
                  scale: isActive ? 1.3 : 1,
                  opacity: isActive ? 1 : isDone ? 0.6 : 0.25,
                }}
                transition={PILL_SPRING}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
