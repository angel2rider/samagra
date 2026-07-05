/**
 * CurriculumSelector (Vite port)
 * ------------------------------
 * Direct port of /tmp/curriculum-explorer/components/curriculum-selector.tsx
 * into the Samagra Textbooks Vite + motion/react stack. Behavior is identical
 * to the reference; Tailwind utility classes have been inlined as `style={{}}`
 * props. CSS classes (cs-*) live in index.css to avoid DOM style thrashing
 * from re-injecting an inline <style> block on every render.
 */
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useMotionValueEvent,
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
  /** Fires whenever the settled selection changes. */
  onChange?: (selection: CurriculumSelection) => void
  className?: string
  /** Snaps rings to these values on mount — used to restore state from sessionStorage. */
  initialSelection?: { language?: string; classLabel?: string; subject?: string }
}

/* ============================ Tuning knobs ============================ */
const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 }
const DIAL_HEIGHT = 360
const DRAG_REF_DEG_PER_ITEM = 30

/* ============================ Geometry ============================ */
const deg2rad = (d: number) => (d * Math.PI) / 180

/** Angular step for the classes ring (12 classes \u00d7 30\u00b0 = full 360\u00b0 circle). */
const SUBJECT_STEP_DEG = 30

/** Angular step for the subjects ring only. Chosen as 360\u00b0/45 \u2248 8\u00b0 so
 *  ~40-subject catalogs (Class 12, Malayalam) fit inside one rotation
 *  without overlap, while 8-subject catalogs (Class 1, English) cluster
 *  tightly on a small arc. Kept separate from SUBJECT_STEP_DEG so the
 *  classes ring keeps its original 30\u00b0 full-circle layout. */
const SUBJECT_RING_STEP_DEG = 8

/** Nearest rotation that snaps the item at `baseAngles[idx]` to 3 o'clock. */
function snapTarget(r: number, idx: number, baseAngles: number[]) {
  const base = baseAngles[idx]
  return -base + 360 * Math.round((r + base) / 360)
}

/** Index of the item currently closest to the 3 o'clock lens. Operates on a
 *  precomputed array of base angles so per-ring step can be tuned
 *  independently and stays constant regardless of how many items the ring
 *  has. */
function closestIndex(r: number, baseAngles: number[]) {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < baseAngles.length; i++) {
    const a = (((baseAngles[i] + r) % 360) + 360) % 360
    const dist = Math.min(a, 360 - a)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

/* ============================ Ring item ============================ */
function RingItem({
  baseAngle,
  radius,
  rotation,
  onClick,
  style,
  buttonStyle,
  children,
}: {
  /** Precomputed angular position in degrees (0 = 3 o'clock). The caller
   *  picks the step so each ring's items share the same density whether
   *  the ring has 4 or 40 items. */
  baseAngle: number
  radius: number
  rotation: MotionValue<number>
  onClick?: () => void
  style?: React.CSSProperties
  buttonStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  const base = baseAngle
  // Use `motion`'s built-in x/y so each item follows the circumference.
  const x = useTransform(rotation, (r) => radius * Math.cos(deg2rad(base + r)))
  const y = useTransform(rotation, (r) => radius * Math.sin(deg2rad(base + r)))
  const dist = useTransform(rotation, (r) => {
    const a = (((base + r) % 360) + 360) % 360
    return Math.min(a, 360 - a)
  })
  const scale = useTransform(dist, [0, 18, 90], [1.3, 1, 0.8])
  const opacity = useTransform(dist, [0, 15, 55], [1, 0.4, 0.2])

  return (
    <motion.div
      style={{
        x,
        y,
        position: 'absolute',
        left: 0,
        top: 0,
        willChange: 'transform',
        ...style,
      }}
    >
      <div style={{ transform: 'translate(-50%, -50%)' }}>
        <motion.button
          type="button"
          onClick={onClick}
          style={{
            scale,
            opacity,
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
        </motion.button>
      </div>
    </motion.div>
  )
}

/* ============================ Summary row ============================ */
function SummaryValue({ value, valueStyle }: { value: string; valueStyle: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={value}
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -18, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          style={{
            gridArea: '1 / 1',
            textWrap: 'balance',
            overflowWrap: 'break-word',
            margin: 0,
            ...valueStyle,
          }}
        >
          {value}
        </motion.p>
      </AnimatePresence>
    </div>
  )
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
  // Rings are client-only interactive transforms; rendering during SSR causes
  // float-precision hydration mismatches, so we mount them after hydration.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Lens must size to *actual rendered* text — characters-per-em is unreliable
  // for proportional fonts. We measure hidden spans.
  const langMeasureRef = useRef<HTMLSpanElement>(null)
  const classMeasureRef = useRef<HTMLSpanElement>(null)
  const subjMeasureRef = useRef<HTMLSpanElement>(null)
  const [langW, setLangW] = useState(80)
  const [classW, setClassW] = useState(70)
  const [subjW, setSubjW] = useState(90)

  // Measure the widest text in each ring so we can dynamically adjust radii
  // and prevent overlap / clipping.
  const [maxLangW, setMaxLangW] = useState(80)
  const [maxClassW, setMaxClassW] = useState(70)
  const [maxSubjW, setMaxSubjW] = useState(90)

  // Dynamic radii: each ring is positioned based on the widest text in that
  // ring so nothing overlaps and nothing is clipped.
  const langRadius = Math.max(78, maxLangW / 2 + 28)
  const classRadius = 168
  const subjRadius = Math.max(285, classRadius + maxClassW / 2 + 24 + maxSubjW / 2)

  const filteredSubjects = useMemo(
    () => subjects.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase())),
    [subjects, query],
  )

  /* Target MotionValues — updated directly by wheel / drag.
   *  The spring MotionValues smoothly follow them without
   *  restarting animations on every event, eliminating
   *  trackpad stutter while preserving spring physics. */
  const langTarget = useMotionValue(0)
  const classTarget = useMotionValue(0)
  const subjTarget = useMotionValue(0)

  const langRot = useSpring(langTarget, SPRING)
  const classRot = useSpring(classTarget, SPRING)
  const subjRot = useSpring(subjTarget, SPRING)

  const [selLang, setSelLang] = useState(0)
  const [selClass, setSelClass] = useState(0)
  const [selSubj, setSelSubj] = useState(0)

  // Per-ring base angles. Each ring has its own fixed step tuned for its
  // catalog size: languages (4 items, full circle), classes (12 items,
  // 30\u00b0 step = full circle), subjects (variable N, 8\u00b0 step = dense
  // cluster for small catalogs, full arc for large catalogs).
  const langBaseAngles = useMemo(
    () => languages.map((_, i) => i * (360 / Math.max(1, languages.length))),
    [languages],
  )
  const classBaseAngles = useMemo(
    () => classes.map((_, i) => i * SUBJECT_STEP_DEG),
    [classes],
  )
  const subjBaseAngles = useMemo(
    () => {
      const n = filteredSubjects.length
      if (n === 0) return []
      if (n === 1) return [0]
      /* Cap the total arc strictly below 360° so large catalogs never have
       *  the first and last subjects collide at the same angle. Small
       *  catalogs still cluster densely with the fixed step. */
      const step = Math.min(SUBJECT_RING_STEP_DEG, 360 / n)
      return filteredSubjects.map((_, i) => i * step)
    },
    [filteredSubjects],
  )

  useMotionValueEvent(langRot, 'change', (r) => setSelLang(closestIndex(r, langBaseAngles)))
  useMotionValueEvent(classRot, 'change', (r) => setSelClass(closestIndex(r, classBaseAngles)))
  useMotionValueEvent(subjRot, 'change', (r) => {
    if (subjBaseAngles.length) setSelSubj(closestIndex(r, subjBaseAngles))
  })

  // Snap language and class rings to saved positions on mount.
  // (Subjects ring snaps later once filteredSubjects contains the saved subject.)
  const initialApplied = useRef(false)
  const initialSubjectApplied = useRef(false)
  useEffect(() => {
    if (!mounted || !initialSelection || initialApplied.current) return
    const langIdx = initialSelection.language ? languages.indexOf(initialSelection.language) : -1
    const classIdx = initialSelection.classLabel ? classes.indexOf(initialSelection.classLabel) : -1
    if (langIdx >= 0) {
      const ba = langBaseAngles
      animate(langTarget, snapTarget(0, langIdx, ba), SPRING)
    }
    if (classIdx >= 0) {
      const ba = classBaseAngles
      animate(classTarget, snapTarget(0, classIdx, ba), SPRING)
    }
    initialApplied.current = true
  }, [mounted]) // eslint-disable-line react-hooks/exhaustive-deps

  // Snap subject ring once the saved subject appears in the filtered list.
  useEffect(() => {
    if (!mounted || !initialSelection?.subject || initialSubjectApplied.current) return
    const subjIdx = filteredSubjects.indexOf(initialSelection.subject)
    if (subjIdx >= 0) {
      const ba = subjBaseAngles
      animate(subjTarget, snapTarget(0, subjIdx, ba), SPRING)
      initialSubjectApplied.current = true
    }
  }, [mounted, filteredSubjects]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset subject ring to the top result whenever the search changes.
  // Skip if we positioned from a saved initial selection.
  useEffect(() => {
    if (initialSubjectApplied.current) return
    animate(subjTarget, 0, SPRING)
    setSelSubj(0)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the subject ring to angle 0 every time the catalog size changes
  // (e.g. user switches medium or class). Without this, switching from
  // Class 12 (more subjects → larger arc) to Class 1 (fewer subjects →
  // smaller arc) would leave the wheel rotated to an angle that doesn't
  // map to any valid baseAngle in the new fixed-step layout, producing
  // a visible desync between snap targets and rendered items.
  // Skip if we positioned from a saved initial selection.
  useEffect(() => {
    if (initialSubjectApplied.current) return
    if (subjects.length > 0) {
      animate(subjTarget, 0, SPRING)
      setSelSubj(0)
    }
  }, [subjects.length]) // eslint-disable-line react-hooks/exhaustive-deps

  /* -------- resolved selection + auto onChange (no button) -------- */
  const langWord = languages[selLang] ?? ''
  const classWord = classes[selClass] ?? ''
  const subjWord = filteredSubjects[selSubj] ?? ''

  useEffect(() => {
    if (!langWord || !classWord || !subjWord) return
    onChange?.({ language: langWord, classLabel: classWord, subject: subjWord })
  }, [langWord, classWord, subjWord]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- pointer / wheel interaction ---------------- */
  const dialRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const rings = useMemo(
    () => [
      { rot: langRot, target: langTarget, radius: langRadius },
      { rot: classRot, target: classTarget, radius: classRadius },
      { rot: subjRot, target: subjTarget, radius: subjRadius },
    ],
    [langRadius, classRadius, subjRadius], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const drag = useRef<{ active: number; prevAngle: number; moved: boolean } | null>(null)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapAnim = useRef<[ReturnType<typeof animate> | null, ReturnType<typeof animate> | null, ReturnType<typeof animate> | null]>([null, null, null])

  /** Per-ring velocity limiters. Large wheel deltas from aggressive flicks
   *  are clamped so the ring never overshoots more than a few items. */
  const MAX_WHEEL_DELTA_ITEMS = 3
  const WHEEL_COOLDOWN_MS = 60
  const lastWheelTime = useRef<[number, number, number]>([0, 0, 0])

  const getCenter = useCallback(() => {
    const rect = anchorRef.current!.getBoundingClientRect()
    return { cx: rect.left, cy: rect.top }
  }, [])

  const pointerAngle = useCallback(
    (px: number, py: number) => {
      const { cx, cy } = getCenter()
      return (Math.atan2(py - cy, px - cx) * 180) / Math.PI
    },
    [getCenter],
  )

  const pickRing = useCallback(
    (px: number, py: number) => {
      const { cx, cy } = getCenter()
      const d = Math.hypot(px - cx, py - cy)
      let best = 0
      let bestDist = Number.POSITIVE_INFINITY
      rings.forEach((ring, i) => {
        const dd = Math.abs(d - ring.radius)
        if (dd < bestDist) {
          bestDist = dd
          best = i
        }
      })
      return best
    },
    [getCenter, rings],
  )

  const snapRing = useCallback(
    (i: number) => {
      const ring = rings[i]
      const r = ring.target.get()
      const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][i]
      const idx = closestIndex(r, baseAngles)
      snapAnim.current[i]?.stop()
      snapAnim.current[i] = animate(ring.target, snapTarget(r, idx, baseAngles), SPRING)
    },
    [langBaseAngles, classBaseAngles, subjBaseAngles, rings],
  )

  /* Clamps rotation for the subjects ring so the user can't scroll past
   *  the last item. The classes and languages rings are full 360° circles,
   *  so they wrap around freely — a small scroll from Class 1 (0°) in the
   *  "up" direction lands on Class 12 (-330° ≡ +30°) instead of forcing a
   *  long 330° scroll through every intermediate class. */
  const clampRotation = (i: number, r: number) => {
    const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][i]
    const step =
      baseAngles.length >= 2 ? baseAngles[1] - baseAngles[0] : SUBJECT_STEP_DEG
    const min = -(baseAngles.length - 1) * step
    // Full-circle rings (languages, classes, and subjects that span most
    // of a rotation) — allow free wrap-around so the user can always
    // take the shorter path to any item.
    const isFullCircle =
      i === 0 ||
      i === 1 ||
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
    // Item-normalized drag. Use the active ring's actual angular step
    // (e.g. 30\u00b0 for class/subj rings, 90\u00b0 for the 4-language ring).
    const baseAngles =
      [langBaseAngles, classBaseAngles, subjBaseAngles][drag.current.active]
    const itemStep =
      baseAngles.length >= 2 ? baseAngles[1] - baseAngles[0] : SUBJECT_STEP_DEG
    const nextR = clampRotation(
      drag.current.active,
      ring.target.get() + d * (itemStep / DRAG_REF_DEG_PER_ITEM),
    )
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
    const itemStep =
      baseAngles.length >= 2 ? baseAngles[1] - baseAngles[0] : SUBJECT_STEP_DEG

    /* Normalise delta so line-mode (Windows) and page-mode wheels
     *  are on the same scale as pixel-mode (macOS) events. */
    let delta = -e.deltaY
    if (e.deltaMode === 1) delta *= 16
    if (e.deltaMode === 2) delta *= 100

    /* ~100 px of wheel travel ≈ one item step. The target is updated
     *  directly; useSpring handles the smoothing without restarting
     *  animations, so trackpads feel fluid and mouse wheels feel
     *  weighty. */
    const WHEEL_SMOOTH_DIVISOR = 100
    let stepDelta = (delta / WHEEL_SMOOTH_DIVISOR) * itemStep

    /* Clamp aggressive flicks so a single event never jumps more than
     *  MAX_WHEEL_DELTA_ITEMS. This prevents the ring from overshooting
     *  wildly when the user spins the scroll wheel fast. */
    const maxStep = MAX_WHEEL_DELTA_ITEMS * itemStep
    stepDelta = Math.max(-maxStep, Math.min(maxStep, stepDelta))

    /* Cooldown: if events are arriving faster than WHEEL_COOLDOWN_MS,
     *  absorb them into the same gesture instead of fighting the spring.
     *  Only snap once the burst ends. */
    const now = performance.now()
    const elapsed = now - lastWheelTime.current[i]
    lastWheelTime.current[i] = now
    const isBurst = elapsed < WHEEL_COOLDOWN_MS

    snapAnim.current[i]?.stop()
    ring.target.set(clampRotation(i, ring.target.get() + stepDelta))

    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    /* After a burst, wait a little longer before snapping so the spring
     *  has time to catch up and the snap doesn't feel like a hard lock. */
    const snapDelay = isBurst ? 220 : 140
    wheelTimer.current = setTimeout(() => {
      snapRing(i)
    }, snapDelay)
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
    // Defensive flush: clear any stale drag bookkeeping. Programmatic
    // clicks (e.g. a11y-driven or test harness) don't issue pointerdown/
    // pointerup, but a previous interrupted drag could leave drag.current
    // pointing at the wrong ring or with moved=true. Resetting here keeps
    // the click code path idempotent.
    drag.current = null
    const ring = rings[ringIndex]
    const baseAngles = [langBaseAngles, classBaseAngles, subjBaseAngles][ringIndex]
    snapAnim.current[ringIndex]?.stop()
    snapAnim.current[ringIndex] = animate(
      ring.target,
      snapTarget(ring.rot.get(), itemIndex, baseAngles),
      SPRING,
    )
  }

  /* ---------------- per-ring max-width measurement ---------------- */
  useEffect(() => {
    if (!mounted) return
    function measure(text: string, styles: React.CSSProperties) {
      const el = document.createElement('span')
      el.textContent = text
      el.style.position = 'absolute'
      el.style.visibility = 'hidden'
      el.style.whiteSpace = 'nowrap'
      Object.assign(el.style, styles as Record<string, string>)
      document.body.appendChild(el)
      const w = el.offsetWidth
      document.body.removeChild(el)
      return w
    }
    const langWs = languages.map((l) =>
      measure(l, { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em' }),
    )
    const classWs = classes.map((c) =>
      measure(c, { fontSize: '28px', fontWeight: 700, lineHeight: 1 }),
    )
    const subjWs = subjects.map((s) =>
      measure(s, { fontSize: '15px', fontWeight: 600 }),
    )
    setMaxLangW(langWs.length ? Math.max(...langWs) : 0)
    setMaxClassW(classWs.length ? Math.max(...classWs) : 0)
    setMaxSubjW(subjWs.length ? Math.max(...subjWs) : 0)
  }, [languages, classes, subjects, mounted])

  /* ---------------- magnifier lens sizing ---------------- */
  useEffect(() => {
    if (langMeasureRef.current) setLangW(langMeasureRef.current.offsetWidth)
    if (classMeasureRef.current) setClassW(classMeasureRef.current.offsetWidth)
    if (subjMeasureRef.current) setSubjW(subjMeasureRef.current.offsetWidth)
  }, [langWord, classWord, subjWord, mounted])

  const LENS_PAD = 18
  const maxTextW = Math.max(langW, classW, subjW)

  // Anchor the lens to the language ring so it always covers all three rows,
  // but make the width track the longest word so long subject names never
  // overflow and short names keep the pill compact.
  const lensLeft = langRadius - langW / 2 - LENS_PAD
  const lensWidth = (subjRadius - langRadius) + maxTextW + LENS_PAD * 2
  const hasResults = filteredSubjects.length > 0

  // (predictor dots removed — they kept mis-aligning with ring items)

  return (
      <div
        className={`cs-card ${active ? 'cs-card--active ' : ''}${className ? ' ' + className : ''}`}
      >
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
          onPointerLeave={() => {
            endDrag()
            setActive(false)
          }}
        >
          <div className="cs-dial-spotlight" />

          <div className="cs-dial-mask">
            <div ref={anchorRef} className="cs-anchor">
              {!mounted ? null : (
                <>
                  {/* subjects (outer) — index-prefixed key for safety against
                      same-named subjects in the catalog */}
                  {filteredSubjects.map((s, i) => (
                    <RingItem
                      key={`subj-${i}-${s}`}
                      baseAngle={subjBaseAngles[i]}
                      radius={subjRadius}
                      rotation={subjRot}
                      onClick={() => clickTo(2, i)}
                      buttonStyle={{
                        whiteSpace: 'nowrap',
                        fontSize: 15,
                        fontWeight: 600,
                        color: '#a97e22',
                      }}
                    >
                      {s}
                    </RingItem>
                  ))}
                  {/* classes (middle) */}
                  {classes.map((c, i) => (
                    <RingItem
                      key={c}
                      baseAngle={classBaseAngles[i]}
                      radius={classRadius}
                      rotation={classRot}
                      onClick={() => clickTo(1, i)}
                      buttonStyle={{
                        fontSize: 28,
                        fontWeight: 700,
                        lineHeight: 1,
                        color: '#3a2c1c',
                      }}
                    >
                      {c}
                    </RingItem>
                  ))}
                  {/* languages (inner) */}
                  {languages.map((l, i) => (
                    <RingItem
                      key={l}
                      baseAngle={langBaseAngles[i]}
                      radius={langRadius}
                      rotation={langRot}
                      onClick={() => clickTo(0, i)}
                      buttonStyle={{
                        whiteSpace: 'nowrap',
                        fontSize: 12,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.14em',
                        color: '#2f5233',
                      }}
                    >
                      {l}
                    </RingItem>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* clear magnifier lens at 3 o'clock */}
          {hasResults && (
            <motion.div
              className="cs-lens"
              animate={{ left: 6 + lensLeft, width: lensWidth }}
              transition={SPRING}
            >
              <div className="cs-lens-sheen" />
              <div className="cs-lens-rim" />
            </motion.div>
          )}

          {/* hidden measurers — must mirror the ring item fonts exactly */}
          <span
            ref={langMeasureRef}
            aria-hidden
            className="cs-measurer"
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
            }}
          >
            {langWord}
          </span>
          <span
            ref={classMeasureRef}
            aria-hidden
            className="cs-measurer"
            style={{
              fontSize: 28,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {classWord}
          </span>
          <span
            ref={subjMeasureRef}
            aria-hidden
            className="cs-measurer"
            style={{ fontSize: 15, fontWeight: 600 }}
          >
            {subjWord}
          </span>

          {/* active-state cue */}
          <div
            className={`cs-active-cue ${
              active ? 'cs-active-cue--visible' : 'cs-active-cue--hidden'
            }`}
          >
            <span className="cs-ping-dot" />
            Scroll to spin
          </div>

          {/* hint */}
          <p className="cs-hint">drag · scroll · tap</p>
        </div>

        {/* -------- right: search + live selection -------- */}
        <div className="cs-sidebar">
          <div className="cs-search">
            <svg className="cs-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a subject…"
              className="cs-search-input"
              aria-label="Find a subject"
            />
          </div>

          <div style={{ flex: 1 }}>
            <p className="cs-summary-title">Current selection</p>
            <div className="cs-summary-rows">
              <SummaryValue
                value={langWord || '—'}
                valueStyle={{ fontSize: 20, fontWeight: 600, color: '#2f5233' }}
              />
              <SummaryValue
                value={classWord ? `Class ${classWord}` : '—'}
                valueStyle={{ fontSize: 20, fontWeight: 600, color: '#3a2c1c' }}
              />
              <SummaryValue
                value={subjWord || 'No match'}
                valueStyle={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, color: '#a97e22' }}
              />
            </div>
          </div>

          <p className="cs-footnote">
            Results update automatically as you spin the dial or search.
          </p>
        </div>
      </div>
  )
}

export default CurriculumSelector
