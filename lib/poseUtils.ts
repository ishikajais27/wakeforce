import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export function angleDeg(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark,
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let deg = Math.abs((radians * 180) / Math.PI)
  if (deg > 180) deg = 360 - deg
  return deg
}

export type SquatPhase =
  | 'calibrating'
  | 'standing'
  | 'descending'
  | 'bottom'
  | 'ascending'
export type DetectionMode = 'angle' | 'vertical'

export interface SquatState {
  phase: SquatPhase
  repCount: number
  mode: DetectionMode
  baseline: number | null
  calibBuffer: number[]
}

export const INITIAL_SQUAT_STATE: SquatState = {
  phase: 'standing',
  repCount: 0,
  mode: 'angle',
  baseline: null,
  calibBuffer: [],
}

// FIXED: Relaxed thresholds — original values were too strict (130/110/125/155)
// causing missed reps. New values match real squat geometry better.
export function updateSquatStateAngle(
  prev: SquatState,
  kneeAngle: number,
): SquatState {
  const phase = prev.phase === 'calibrating' ? 'standing' : prev.phase
  const { repCount } = prev
  switch (phase) {
    case 'standing':
      // Start descending when knee bends past ~145° (was 130 — too tight)
      return kneeAngle < 145
        ? { ...prev, phase: 'descending', mode: 'angle' }
        : prev
    case 'descending':
      // Reached bottom at ~100° (was 110); abort squat if nearly straight again
      if (kneeAngle < 105) return { ...prev, phase: 'bottom', mode: 'angle' }
      if (kneeAngle > 160) return { ...prev, phase: 'standing', mode: 'angle' }
      return prev
    case 'bottom':
      // Start rising once past ~120° (was 125)
      return kneeAngle > 120
        ? { ...prev, phase: 'ascending', mode: 'angle' }
        : prev
    case 'ascending':
      // Count rep when fully standing ~160° (was 155)
      return kneeAngle > 160
        ? { ...prev, phase: 'standing', repCount: repCount + 1, mode: 'angle' }
        : prev
    default:
      return prev
  }
}

const CALIB_FRAMES = 15

export function updateSquatStateVertical(
  prev: SquatState,
  hipY: number,
  torsoLen: number,
): SquatState {
  if (torsoLen <= 0.01) return prev
  const normalized = hipY / torsoLen

  if (prev.phase === 'calibrating' || prev.baseline === null) {
    const buf = [...prev.calibBuffer, normalized]
    if (buf.length < CALIB_FRAMES)
      return {
        ...prev,
        phase: 'calibrating',
        mode: 'vertical',
        calibBuffer: buf,
      }
    const baseline = buf.reduce((s, v) => s + v, 0) / buf.length
    return {
      ...prev,
      phase: 'standing',
      mode: 'vertical',
      baseline,
      calibBuffer: [],
    }
  }

  const drop = normalized - prev.baseline
  const { phase, repCount } = prev
  switch (phase) {
    case 'standing':
      // FIXED: lowered from 0.18 — small movements register better
      return drop > 0.15
        ? { ...prev, phase: 'descending', mode: 'vertical' }
        : prev
    case 'descending':
      if (drop > 0.35) return { ...prev, phase: 'bottom', mode: 'vertical' }
      if (drop < 0.06) return { ...prev, phase: 'standing', mode: 'vertical' }
      return prev
    case 'bottom':
      return drop < 0.25
        ? { ...prev, phase: 'ascending', mode: 'vertical' }
        : prev
    case 'ascending':
      return drop < 0.08
        ? {
            ...prev,
            phase: 'standing',
            repCount: repCount + 1,
            mode: 'vertical',
          }
        : prev
    default:
      return prev
  }
}

export function getLandmarkBoundingBox(
  landmarks: any[],
  minVis = 0.3,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const vis = landmarks.filter((lm) => (lm?.visibility ?? 1) > minVis)
  if (vis.length < 4) return null
  return {
    minX: Math.min(...vis.map((lm) => lm.x)),
    minY: Math.min(...vis.map((lm) => lm.y)),
    maxX: Math.max(...vis.map((lm) => lm.x)),
    maxY: Math.max(...vis.map((lm) => lm.y)),
  }
}

// FIXED: Rebalanced penalty weights so scores aren't artificially low.
// Head-centering (landmark 0) now only fires when nose visibility > 0.6.
// Each penalty capped lower so a slightly tilted head doesn't tank the score.
export function computePostureScore(landmarks: any[]): number {
  const lSh = landmarks[11]
  const rSh = landmarks[12]
  const lHip = landmarks[23]
  const rHip = landmarks[24]
  const lEar = landmarks[7]
  const rEar = landmarks[8]
  const nose = landmarks[0]

  let penalty = 0

  // 1. Shoulder levelness — max 25 penalty (was 30)
  if (
    lSh &&
    rSh &&
    (lSh.visibility ?? 0) > 0.5 &&
    (rSh.visibility ?? 0) > 0.5
  ) {
    penalty += Math.min(Math.abs(lSh.y - rSh.y) * 250, 25)
  }

  // 2. Hip levelness — max 15 penalty (was 20)
  if (
    lHip &&
    rHip &&
    (lHip.visibility ?? 0) > 0.5 &&
    (rHip.visibility ?? 0) > 0.5
  ) {
    penalty += Math.min(Math.abs(lHip.y - rHip.y) * 150, 15)
  }

  // 3. Head centering — max 20 penalty; FIXED: require nose vis > 0.6 (was 0.5)
  // and both shoulders visible to avoid false penalty when face is cut off
  if (
    nose &&
    lSh &&
    rSh &&
    (nose.visibility ?? 0) > 0.6 &&
    (lSh.visibility ?? 0) > 0.5 &&
    (rSh.visibility ?? 0) > 0.5
  ) {
    const midShX = (lSh.x + rSh.x) / 2
    penalty += Math.min(Math.abs(nose.x - midShX) * 200, 20)
  }

  // 4. Forward-head posture — max 20 penalty (was 25)
  const earLm = (lEar?.visibility ?? 0) > (rEar?.visibility ?? 0) ? lEar : rEar
  const shLm = (lSh?.visibility ?? 0) > (rSh?.visibility ?? 0) ? lSh : rSh
  if (
    earLm &&
    shLm &&
    (earLm.visibility ?? 0) > 0.45 &&
    (shLm.visibility ?? 0) > 0.45
  ) {
    penalty += Math.min(Math.abs(earLm.x - shLm.x) * 200, 20)
  }

  return Math.max(0, Math.round(100 - penalty))
}

export function postureLabel(score: number): string {
  if (score >= 90) return 'Excellent! 🌟'
  if (score >= 75) return 'Good posture 👍'
  if (score >= 55) return 'Straighten up a bit'
  return 'Adjust your posture'
}

export function postureColor(score: number): string {
  if (score >= 75) return 'var(--mint)'
  if (score >= 55) return 'var(--accent)'
  return 'var(--danger)'
}
