import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/** Angle in degrees at vertex B formed by points A–B–C */
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
  baseline: number | null // only used by vertical mode
  calibBuffer: number[] // only used by vertical mode
}

export const INITIAL_SQUAT_STATE: SquatState = {
  phase: 'standing',
  repCount: 0,
  mode: 'angle',
  baseline: null,
  calibBuffer: [],
}

/**
 * PRIMARY method — used whenever hip, knee AND ankle are confidently
 * visible (full body in frame). Thresholds on hip-knee-ankle angle:
 *   > 155°  → standing
 *   < 130°  → descending
 *   < 110°  → bottom
 *   > 125° while at bottom → ascending
 */
export function updateSquatStateAngle(
  prev: SquatState,
  kneeAngle: number,
): SquatState {
  const phase = prev.phase === 'calibrating' ? 'standing' : prev.phase
  const { repCount } = prev

  switch (phase) {
    case 'standing':
      return kneeAngle < 130
        ? { ...prev, phase: 'descending', mode: 'angle' }
        : prev
    case 'descending':
      if (kneeAngle < 110) return { ...prev, phase: 'bottom', mode: 'angle' }
      if (kneeAngle > 155) return { ...prev, phase: 'standing', mode: 'angle' }
      return prev
    case 'bottom':
      return kneeAngle > 125
        ? { ...prev, phase: 'ascending', mode: 'angle' }
        : prev
    case 'ascending':
      return kneeAngle > 155
        ? { ...prev, phase: 'standing', repCount: repCount + 1, mode: 'angle' }
        : prev
    default:
      return prev
  }
}

/**
 * FALLBACK method — used when knees/ankles are out of frame (very common
 * with laptop webcams) but shoulders + hips are visible. Tracks how far the
 * mid-hip point drops on screen, normalized by torso length, relative to a
 * per-session calibrated "standing" baseline (absolute screen position
 * depends on each person's camera height/distance, so we can't hardcode it).
 */
const CALIB_FRAMES = 15

export function updateSquatStateVertical(
  prev: SquatState,
  hipY: number,
  torsoLen: number,
): SquatState {
  if (torsoLen <= 0.01) return prev

  const normalized = hipY / torsoLen

  // Calibrate the standing baseline the first time we see this person
  if (prev.phase === 'calibrating' || prev.baseline === null) {
    const buf = [...prev.calibBuffer, normalized]
    if (buf.length < CALIB_FRAMES) {
      return {
        ...prev,
        phase: 'calibrating',
        mode: 'vertical',
        calibBuffer: buf,
      }
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

  const drop = normalized - prev.baseline // positive = hips moved down = squatting
  const { phase, repCount } = prev

  switch (phase) {
    case 'standing':
      return drop > 0.18
        ? { ...prev, phase: 'descending', mode: 'vertical' }
        : prev
    case 'descending':
      if (drop > 0.4) return { ...prev, phase: 'bottom', mode: 'vertical' }
      if (drop < 0.08) return { ...prev, phase: 'standing', mode: 'vertical' }
      return prev
    case 'bottom':
      return drop < 0.3
        ? { ...prev, phase: 'ascending', mode: 'vertical' }
        : prev
    case 'ascending':
      return drop < 0.1
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
