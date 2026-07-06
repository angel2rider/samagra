/**
 * CurriculumSelector — Performance-optimised
 * ------------------------------------------
 * Ring items are positioned via a single requestAnimationFrame loop that reads
 * spring MotionValues and writes inline transform/opacity to plain DOM refs.
 * This eliminates per-item useTransform (330 derived values), per-item GPU
 * layers from willChange, and the motion.div/button component overhead.
 *
 * The spring physics, wheel/drag interaction, and visual appearance are
 * unchanged.
 */
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  motion,
  AnimatePresence,
  useMotionValue,
  animate,
  useSpring,
  type MotionValue,
} from 'motion/react'


/* ============================ Public API ============================ */
export interface CurriculumSelection {
  language: string
  classLabel: string
  subject: string
}

export interface CurriculumSelectorProps {
  languages: string[]
  classes: string[]
  subjects: string[]
  onChange?: (selection: CurriculumSelection) => void
  className?: string
  initialSelection?: { language?: string; classLabel?: string; subject?: string }
}

/* ============================ Tuning knobs ============================ */
const SPRING = { type: 'spring' as const, stiffness: 170, damping: 30 }
const SNAP_SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 }
const DIAL_HEIGHT = 360
const DRAG_REF_DEG_PER_ITEM = 30

/* ============================ Geometry ============================ */
const deg2rad = (d: number) => (d * Math.PI) / 180
const SUBJECT_STEP_DEG = 30
const SUBJECT_RING_STEP_DEG = 8

function snapTarget(r: number, idx: number, baseAngles: number[]) {
  const base = baseAngles[idx]
  return -base + 360 * Math.round((r + base) / 360)
}

function closestIndex(r: number, baseAngles: number[]) {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < baseAngles.length; i++) {
    const a = (((baseAngles[i] + r) % 360) + 360) % 360
    const dist = Math.min(a, 360 - a)
    if (dist < bestDist) { bestDist = dist; best = i }
  }
  return best
}

/** Compute scale + opacity from angular distance to 3 o'clock. */
function scaleForDist(d: number) {
  if (d < 18) return 1.3 - (d / 18) * 0.3
  if (d < 90) return 1 - ((d - 18) / 72) * 0.2
  return 0.8
}
function opacityForDist(d: number) {
  if (d < 15) return 1
  if (d < 55) return 1 - ((d - 15) / 40) * 0.6
  return 0.2
}

/* ============================ Ring item (plain DOM, no motion) ====== */
function RingItem({
  elRef,
  onClick,
  children,
  style,
  buttonStyle,
}: {
  elRef: (el: HTMLDivElement | null) => void
  onClick?: () => void
  children: React.ReactNode
  style?: React.CSSProperties
  buttonStyle?: React.CSSProperties
}) {
  return (
    <div ref={elRef} style={{ position: 'absolute', left: 0, top: 0, ...style }}>
      <div style={{ transform: 'translate(-50%, -50%)' }}>
        <button
          type="button"
          onClick={onClick}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            ...buttonStyle,
          }}
        >
          {children}
        </button>
      </div>
    </div>
  )
}

/* ============================ Summary row ============================ */
function SummaryValue({ value, valueStyle }: { value: string; valueStyle: React.CSSProperties }) {
  return (
    <div style={{ position: 'relative', display: 'grid' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={value}
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -18, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          style={{ gridArea: '1 / 1', textWrap: 'balance', overflowWrap: 'break-word', margin: 0, ...valueStyle }}
        >
          {value}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

/* ============================ useRingAnimation hook ================= */
/** Drives a single RAF loop that positions ring items and updates their scale/opacity. */
function useRingAnimation(
  langRot: MotionValue<number>,
  classRot: MotionValue<number>,
  subjRot: MotionValue<number>,
  langBaseAngles: number[],
  classBaseAngles: number[],
  subjBaseAngles: number[],
  langRadius: number,
  classRadius: number,
  subjRadius: number,
) {
  // Refs to each ring's item containers — populated via callback refs.
  const langRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const classRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const subjRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Factory callbacks for RingItem's elRef prop
  const makeLangRef = useCallback((i: number) => (el: HTMLDivElement | null) => {
    if (el) langRefs.current.set(i, el); else langRefs.current.delete(i)
  }, [])
  const makeClassRef = useCallback((i: number) => (el: HTMLDivElement | null) => {
    if (el) classRefs.current.set(i, el); else classRefs.current.delete(i)
  }, [])
  const makeSubjRef = useCallback((i: number) => (el: HTMLDivElement | null) => {
    if (el) subjRefs.current.set(i, el); else subjRefs.current.delete(i)
  }, [])

  useEffect(() => {
    let running = true
    function tick() {
      if (!running) return
      const lr = langRot.get()
      const cr = classRot.get()
      const sr = subjRot.get()

      // --- Languages ring ---
      langRefs.current.forEach((el, i) => {
        const ba = langBaseAngles[i]
        if (ba === undefined) return
        const angle = ba + lr
        const rad = angle * Math.PI / 180
        const x = langRadius * Math.cos(rad)
        const y = langRadius * Math.sin(rad)
        el.style.transform = `translate(${x}px, ${y}px)`
        const a = ((angle % 360) + 360) % 360
        const dist = Math.min(a, 360 - a)
        const btn = el.firstChild?.firstChild as HTMLElement | null
        if (btn) {
          btn.style.transform = `scale(${scaleForDist(dist)})`
          btn.style.opacity = String(opacityForDist(dist))
        }
      })

      // --- Classes ring ---
      classRefs.current.forEach((el, i) => {
        const ba = classBaseAngles[i]
        if (ba === undefined) return
        const angle = ba + cr
        const rad = angle * Math.PI / 180
        const x = classRadius * Math.cos(rad)
        const y = classRadius * Math.sin(rad)
        el.style.transform = `translate(${x}px, ${y}px)`
        const a = ((angle % 360) + 360) % 360
        const dist = Math.min(a, 360 - a)
        const btn = el.firstChild?.firstChild as HTMLElement | null
        if (btn) {
          btn.style.transform = `scale(${scaleForDist(dist)})`
          btn.style.opacity = String(opacityForDist(dist))
        }
      })

      // --- Subjects ring ---
      subjRefs.current.forEach((el, i) => {
        const ba = subjBaseAngles[i]
        if (ba === undefined) return
        const angle = ba + sr
        const rad = angle * Math.PI / 180
        const x = subjRadius * Math.cos(rad)
        const y = subjRadius * Math.sin(rad)
        el.style.transform = `translate(${x}px, ${y}px)`
        const a = ((angle % 360) + 360) % 360
        const dist = Math.min(a, 360 - a)
        const btn = el.firstChild?.firstChild as HTMLElement | null
        if (btn) {
          btn.style.transform = `scale(${scaleForDist(dist)})`
          btn.style.opacity = String(opacityForDist(dist))
        }
      })

      requestAnimationFrame(tick)
    }
    const raf = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(raf) }
  }, [langBaseAngles, classBaseAngles, subjBaseAngles, langRadius, classRadius, subjRadius, langRot, classRot, subjRot])

  return { makeLangRef, makeClassRef, makeSubjRef }
}

/* ============================ Component ============================ */
export function CurriculumSelector({
  languages,
  classes,
  subjects,
  onChange,
  className,
  initialSelection,
}: CurriculumSelectorProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Lens measurement refs
  const langMeasureRef = useRef<HTMLSpanElement>(null)
  const classMeasureRef = useRef<HTMLSpanElement>(null)
  const subjMeasureRef = useRef<HTMLSpanElement>(null)
  const [langW, setLangW] = useState(80)
  const [classW, setClassW] = useState(70)
  const [subjW, setSubjW] = useState(90)

  const [maxLangW, setMaxLangW] = useState(80)
  const [maxClassW, setMaxClassW] = useState(70)
  const [maxSubjW, setMaxSubjW] = useState(90)

  const langRadius = Math.max(78, maxLangW / 2 + 28)
  const classRadius = 168
  const subjRadius = Math.max(285, classRadius + maxClassW / 2 + 24 + maxSubjW / 2)

  const filteredSubjects = useMemo(
    () => subjects.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase())),
    [subjects, query],
  )

  /* Spring-driven MotionValues for smooth physics */
  const langTarget = useMotionValue(0)
  const classTarget = useMotionValue(0)
  const subjTarget = useMotionValue(0)

  const langRot = useSpring(langTarget, SPRING)
  const classRot = useSpring(classTarget, SPRING)
  const subjRot = useSpring(subjTarget, SPRING)

  const [selLang, setSelLang] = useState(0)
  const [selClass, setSelClass] = useState(0)
  const [selSubj, setSelSubj] = useState(0)

  // RAF-throttled state update flags
  const langPending = useRef<number>(-1)
  const classPending = useRef<number>(-1)
  const subjPending = useRef<number>(-1)
  const rafPending = useRef(false)

  // Base angles
  const langBaseAngles = useMemo(
    () => languages.map((_, i) => i * (360 / Math.max(1, languages.length))),
    [languages],
  )
  const classBaseAngles = useMemo(
    () => classes.map((_, i) => i * SUBJECT_STEP_DEG),
    [classes],
  )
  const subjBaseAngles = useMemo(() => {
    const n = filteredSubjects.length
    if (n === 0) return [] as number[]
    if (n === 1) return [0] as number[]
    const step = Math.min(SUBJECT_RING_STEP_DEG, 360 / n)
    return filteredSubjects.map((_, i) => i * step)
  }, [filteredSubjects])

  // RAF-throttled motion value callbacks
  useEffect(() => {
    const unsub1 = langRot.on('change', (r: number) => {
      const idx = closestIndex(r, langBaseAngles)
      langPending.current = idx
      if (!rafPending.current) {
        rafPending.current = true
        requestAnimationFrame(() => {
          rafPending.current = false
          if (langPending.current >= 0) setSelLang(langPending.current)
          if (classPending.current >= 0) setSelClass(classPending.current)
          if (subjPending.current >= 0) setSelSubj(subjPending.current)
          langPending.current = -1; classPending.current = -1; subjPending.current = -1
        })
      }
    })
    const unsub2 = classRot.on('change', (r: number) => {
      const idx = closestIndex(r, classBaseAngles)
      classPending.current = idx
      if (!rafPending.current) {
        rafPending.current = true
        requestAnimationFrame(() => {
          rafPending.current = false
          if (langPending.current >= 0) setSelLang(langPending.current)
          if (classPending.current >= 0) setSelClass(classPending.current)
          if (subjPending.current >= 0) setSelSubj(subjPending.current)
          langPending.current = -1; classPending.current = -1; subjPending.current = -1
        })
      }
    })
    const unsub3 = subjRot.on('change', (r: number) => {
      if (!subjBaseAngles.length) return
      const idx = closestIndex(r, subjBaseAngles)
      subjPending.current = idx
      if (!rafPending.current) {
        rafPending.current = true
        requestAnimationFrame(() => {
          rafPending.current = false
          if (langPending.current >= 0) setSelLang(langPending.current)
          if (classPending.current >= 0) setSelClass(classPending.current)
          if (subjPending.current >= 0) setSelSubj(subjPending.current)
          langPending.current = -1; classPending.current = -1; subjPending.current = -1
        })
      }
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [langBaseAngles, classBaseAngles, subjBaseAngles, langRot, classRot, subjRot])

  // Snap rings to initialSelection on mount
  const initialApplied = useRef(false)
  const initialSubjectApplied = useRef(false)
  useEffect(() => {
    if (!mounted || !initialSelection || initialApplied.current) return
    const langIdx = initialSelection.language ? languages.indexOf(initialSelection.language) : -1
    const classIdx = initialSelection.classLabel ? classes.indexOf(initialSelection.classLabel) : -1
    if (langIdx >= 0) animate(langTarget, snapTarget(0, langIdx, langBaseAngles), SNAP_SPRING)
    if (classIdx >= 0) animate(classTarget, snapTarget(0, classIdx, classBaseAngles), SNAP_SPRING)
    initialApplied.current = true
  }, [mounted])

  useEffect(() => {
    if (!mounted || !initialSelection?.subject || initialSubjectApplied.current) return
    const subjIdx = filteredSubjects.indexOf(initialSelection.subject)
    if (subjIdx >= 0) {
      animate(subjTarget, snapTarget(0, subjIdx, subjBaseAngles), SNAP_SPRING)
      initialSubjectApplied.current = true
    }
  }, [mounted, filteredSubjects])

  useEffect(() => {
    if (initialSubjectApplied.current) return
    animate(subjTarget, 0, SNAP_SPRING)
    setSelSubj(0)
  }, [query])

  useEffect(() => {
    if (initialSubjectApplied.current) return
    if (subjects.length > 0) {
      animate(subjTarget, 0, SNAP_SPRING)
      setSelSubj(0)
    }
  }, [subjects.length])

  // Resolved selection
  const langWord = languages[selLang] ?? ''
  const classWord = classes[selClass] ?? ''
  const subjWord = filteredSubjects[selSubj] ?? ''

  useEffect(() => {
    if (!langWord || !classWord || !subjWord) return
    onChange?.({ language: langWord, classLabel: classWord, subject: subjWord })
  }, [langWord, classWord, subjWord])

  // Animation hook
  const dialRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const { makeLangRef, makeClassRef, makeSubjRef } = useRingAnimation(
    langRot, classRot, subjRot,
    langBaseAngles, classBaseAngles, subjBaseAngles,
    langRadius, classRadius, subjRadius,
  )

  // Pointer / wheel interaction
  const rings = useMemo(() => [
    { rot: langRot, target: langTarget, radius: langRadius },
    { rot: classRot, target: classTarget, radius: classRadius },
    { rot: subjRot, target: subjTarget, radius: subjRadius },
  ], [langRadius, classRadius, subjRadius])

  const drag = useRef<{ active: number; prevAngle: number; moved: boolean } | null>(null)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapAnim = useRef<[ReturnType<typeof animate> | null, ReturnType<typeof animate> | null, ReturnType<typeof animate> | null]>([null, null, null])
  const MAX_WHEEL_DELTA_ITEMS = 3
  const WHEEL_COOLDOWN_MS = 60
  const lastWheelTime = useRef<[number, number, number]>([0, 0, 0])

  const getCenter = useCallback(() => {
    const rect = anchorRef.current!.getBoundingClientRect()
    return { cx: rect.left, cy: rect.top }
  }, [])

  const pointerAngle = useCallback((px: number, py: number) => {
    const { cx, cy } = getCenter()
    return (Math.atan2(py - cy, px - cx) * 180) / Math.PI
  }, [getCenter])

  const pickRing = useCallback((px: number, py: number) => {
    const { cx, cy } = getCenter()
    const d = Math.hypot(px - cx, py - cy)
    let best = 0, bestDist = Number.POSITIVE_INFINITY
    rings.forEach((ring, i) => {
      const dd = Math.abs(d - ring.radius)
      if (dd < bestDist) { bestDist = dd; best = i }
    })
    return best
  }, [getCenter, rings])

  const snapRing = useCallback((i: number) => {
    const ring = rings[i]
    const r = ring.target.get()
    const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][i]
    const idx = closestIndex(r, baseAngles)
    snapAnim.current[i]?.stop()
    snapAnim.current[i] = animate(ring.target, snapTarget(r, idx, baseAngles), SNAP_SPRING)
  }, [langBaseAngles, classBaseAngles, subjBaseAngles, rings])

  const clampRotation = (i: number, r: number) => {
    const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][i]
    const step = baseAngles.length >= 2 ? baseAngles[1] - baseAngles[0] : SUBJECT_STEP_DEG
    const min = -(baseAngles.length - 1) * step
    const isFullCircle = i === 0 || i === 1 ||
      (i === 2 && baseAngles.length >= 2 && baseAngles[baseAngles.length - 1] >= 330)
    if (isFullCircle) return r
    return Math.max(min, Math.min(0, r))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const ring = pickRing(e.clientX, e.clientY)
    snapAnim.current[ring]?.stop()
    drag.current = { active: ring, prevAngle: pointerAngle(e.clientX, e.clientY), moved: false }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const cur = pointerAngle(e.clientX, e.clientY)
    let d = cur - drag.current.prevAngle
    if (d > 180) d -= 360
    if (d < -180) d += 360
    if (Math.abs(d) > 0.4) drag.current.moved = true
    const ring = rings[drag.current.active]
    const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][drag.current.active]
    const itemStep = baseAngles.length >= 2 ? baseAngles[1] - baseAngles[0] : SUBJECT_STEP_DEG
    const nextR = clampRotation(drag.current.active, ring.target.get() + d * (itemStep / DRAG_REF_DEG_PER_ITEM))
    ring.target.set(nextR)
    drag.current.prevAngle = cur
  }

  const endDrag = () => {
    if (!drag.current) return
    snapRing(drag.current.active)
    drag.current = null
  }

  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {})
  wheelHandler.current = (e: WheelEvent) => {
    e.preventDefault()
    const i = pickRing(e.clientX, e.clientY)
    const ring = rings[i]
    const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][i]
    const itemStep = baseAngles.length >= 2 ? baseAngles[1] - baseAngles[0] : SUBJECT_STEP_DEG
    let delta = -e.deltaY
    if (e.deltaMode === 1) delta *= 16
    if (e.deltaMode === 2) delta *= 100
    let stepDelta = (delta / 100) * itemStep
    const maxStep = MAX_WHEEL_DELTA_ITEMS * itemStep
    stepDelta = Math.max(-maxStep, Math.min(maxStep, stepDelta))
    const now = performance.now()
    const elapsed = now - lastWheelTime.current[i]
    lastWheelTime.current[i] = now
    const isBurst = elapsed < WHEEL_COOLDOWN_MS
    snapAnim.current[i]?.stop()
    ring.target.set(clampRotation(i, ring.target.get() + stepDelta))
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => snapRing(i), isBurst ? 220 : 140)
  }

  useEffect(() => {
    const el = dialRef.current
    if (!el) return
    const handler = (e: WheelEvent) => wheelHandler.current(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const clickTo = (ringIndex: number, itemIndex: number) => {
    if (drag.current?.moved) return
    drag.current = null
    const ring = rings[ringIndex]
    const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][ringIndex]
    snapAnim.current[ringIndex]?.stop()
    snapAnim.current[ringIndex] = animate(ring.target, snapTarget(ring.rot.get(), itemIndex, baseAngles), SNAP_SPRING)
  }

  // Width measurement
  useEffect(() => {
    if (!mounted) return
    function measure(text: string, styles: React.CSSProperties) {
      const el = document.createElement('span')
      el.textContent = text
      Object.assign(el.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap' }, styles as Record<string, string>)
      document.body.appendChild(el)
      const w = el.offsetWidth
      document.body.removeChild(el)
      return w
    }
    const langWs = languages.map((l) => measure(l, { fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.14em' }))
    const classWs = classes.map((c) => measure(c, { fontSize: '28px', fontWeight: '700', lineHeight: '1' }))
    const subjWs = subjects.map((s) => measure(s, { fontSize: '15px', fontWeight: '600' }))
    setMaxLangW(langWs.length ? Math.max(...langWs) : 0)
    setMaxClassW(classWs.length ? Math.max(...classWs) : 0)
    setMaxSubjW(subjWs.length ? Math.max(...subjWs) : 0)
  }, [languages, classes, subjects, mounted])

  useEffect(() => {
    if (langMeasureRef.current) setLangW(langMeasureRef.current.offsetWidth)
    if (classMeasureRef.current) setClassW(classMeasureRef.current.offsetWidth)
    if (subjMeasureRef.current) setSubjW(subjMeasureRef.current.offsetWidth)
  }, [langWord, classWord, subjWord, mounted])

  const LENS_PAD = 18
  const maxTextW = Math.max(langW, classW, subjW)
  const lensLeft = langRadius - langW / 2 - LENS_PAD
  const lensWidth = (subjRadius - langRadius) + maxTextW + LENS_PAD * 2
  const hasResults = filteredSubjects.length > 0

  return (
      <div className={`cs-card ${active ? 'cs-card--active ' : ''}${className ? ' ' + className : ''}`}>
        {/* -------- left: the dial -------- */}
        <div
          ref={dialRef}
          role="group"
          aria-label="Curriculum dial. Scroll or drag to change selection."
          className="cs-dial"
          style={{ height: DIAL_HEIGHT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerEnter={() => setActive(true)}
          onPointerLeave={() => { endDrag(); setActive(false) }}
        >
          <div className="cs-dial-spotlight" />

          <div className="cs-dial-mask" style={{ contain: 'layout style paint' }}>
            <div ref={anchorRef} className="cs-anchor" style={{ contain: 'layout style' }}>
              {!mounted ? null : (
                <>
                  {/* subjects (outer) */}
                  {filteredSubjects.map((s, i) => (
                    <RingItem
                      key={`subj-${i}-${s}`}
                      elRef={makeSubjRef(i)}
                      onClick={() => clickTo(2, i)}
                      buttonStyle={{ whiteSpace: 'nowrap', fontSize: 15, fontWeight: 600, color: '#a97e22' }}
                    >{s}</RingItem>
                  ))}
                  {/* classes (middle) */}
                  {classes.map((c, i) => (
                    <RingItem
                      key={c}
                      elRef={makeClassRef(i)}
                      onClick={() => clickTo(1, i)}
                      buttonStyle={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: '#3a2c1c' }}
                    >{c}</RingItem>
                  ))}
                  {/* languages (inner) */}
                  {languages.map((l, i) => (
                    <RingItem
                      key={l}
                      elRef={makeLangRef(i)}
                      onClick={() => clickTo(0, i)}
                      buttonStyle={{ whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#2f5233' }}
                    >{l}</RingItem>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* magnifier lens at 3 o'clock */}
          {hasResults && (
            <motion.div
              className="cs-lens"
              animate={{ left: 6 + lensLeft, width: lensWidth }}
              transition={SNAP_SPRING}
            >
              <div className="cs-lens-sheen" />
              <div className="cs-lens-rim" />
            </motion.div>
          )}

          {/* hidden measurers */}
          <span ref={langMeasureRef} aria-hidden className="cs-measurer" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em' }}>{langWord}</span>
          <span ref={classMeasureRef} aria-hidden className="cs-measurer" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{classWord}</span>
          <span ref={subjMeasureRef} aria-hidden className="cs-measurer" style={{ fontSize: 15, fontWeight: 600 }}>{subjWord}</span>

          <div className={`cs-active-cue ${active ? 'cs-active-cue--visible' : 'cs-active-cue--hidden'}`}>
            <span className="cs-ping-dot" />Scroll to spin
          </div>
          <p className="cs-hint">drag · scroll · tap</p>
        </div>

        {/* -------- right: search + live selection -------- */}
        <div className="cs-sidebar">
          <div className="cs-search">
            <svg className="cs-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a subject…" className="cs-search-input" aria-label="Find a subject" />
          </div>
          <div style={{ flex: 1 }}>
            <p className="cs-summary-title">Current selection</p>
            <div className="cs-summary-rows">
              <SummaryValue value={langWord || '—'} valueStyle={{ fontSize: 20, fontWeight: 600, color: '#2f5233' }} />
              <SummaryValue value={classWord ? `Class ${classWord}` : '—'} valueStyle={{ fontSize: 20, fontWeight: 600, color: '#3a2c1c' }} />
              <SummaryValue value={subjWord || 'No match'} valueStyle={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, color: '#a97e22' }} />
            </div>
          </div>
          <p className="cs-footnote">Results update automatically as you spin the dial or search.</p>
        </div>
      </div>
  )
}

export default CurriculumSelector
