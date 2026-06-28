'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  updateSquatStateAngle,
  updateSquatStateVertical,
  INITIAL_SQUAT_STATE,
  SquatState,
  angleDeg,
  computePostureScore,
} from '@/lib/poseUtils'

export type PoseStage =
  | 'loading-model'
  | 'requesting-camera'
  | 'tracking'
  | 'error'

interface UsePoseDetectionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  innerRef?: React.RefObject<HTMLDivElement | null>
  active: boolean
  targetReps: number
  onComplete: () => void
  onPostureScore?: (score: number) => void
}

// Extend MediaTrackConstraintSet to include non-standard zoom + torch fields
// that Chrome on Android supports but are absent from the TS lib types.
interface ExtendedTrackConstraintSet extends MediaTrackConstraintSet {
  zoom?: ConstrainDouble
}
interface ExtendedTrackConstraints extends MediaTrackConstraints {
  advanced?: ExtendedTrackConstraintSet[]
}
interface ExtendedStreamConstraints {
  video: ExtendedTrackConstraints
}

const LEG_MIN_VIS = 0.9
const TORSO_MIN_VIS = 0.6

// ── Pre-load the MediaPipe WASM bundle immediately when this module is
//    imported — well before the user taps "Let's go". This eliminates the
//    multi-second model-download delay that made the alarm feel slow.
let _posePromise: Promise<any> | null = null

function preloadPoseModel() {
  if (_posePromise) return _posePromise
  _posePromise = (async () => {
    const { PoseLandmarker, FilesetResolver } =
      await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
    )
    const pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    })
    return pose
  })()
  return _posePromise
}

// Kick off the download the moment this module is first imported
// (i.e. as soon as the ringing page mounts its first import).
if (typeof window !== 'undefined') {
  preloadPoseModel().catch(() => {
    // Reset so it can retry when the hook actually runs
    _posePromise = null
  })
}

export function usePoseDetection({
  videoRef,
  canvasRef,
  innerRef,
  active,
  targetReps,
  onComplete,
  onPostureScore,
}: UsePoseDetectionOptions) {
  const [squat, setSquat] = useState<SquatState>(INITIAL_SQUAT_STATE)
  const [postureScore, setPostureScore] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<PoseStage>('loading-model')
  const [isRearCamera, setIsRearCamera] = useState(false)

  const stateRef = useRef<SquatState>(INITIAL_SQUAT_STATE)
  const rafRef = useRef<number>(0)
  const poseRef = useRef<any>(null)
  const completedRef = useRef(false)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scoreTsRef = useRef(0)
  const onCompleteRef = useRef(onComplete)
  const onPostureScoreRef = useRef(onPostureScore)

  useEffect(() => {
    onCompleteRef.current = onComplete
  })
  useEffect(() => {
    onPostureScoreRef.current = onPostureScore
  })

  const drawSkeleton = useCallback(
    (landmarks: any[], ctx: CanvasRenderingContext2D) => {
      const CONNECTIONS = [
        [23, 25],
        [25, 27],
        [24, 26],
        [26, 28],
        [11, 23],
        [12, 24],
        [11, 12],
        [23, 24],
        [11, 13],
        [13, 15],
        [12, 14],
        [14, 16],
      ]
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.strokeStyle = 'rgba(99,215,155,0.85)'
      ctx.lineWidth = 2.5
      CONNECTIONS.forEach(([i, j]) => {
        const a = landmarks[i],
          b = landmarks[j]
        if (!a || !b || (a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3)
          return
        ctx.beginPath()
        ctx.moveTo(a.x * ctx.canvas.width, a.y * ctx.canvas.height)
        ctx.lineTo(b.x * ctx.canvas.width, b.y * ctx.canvas.height)
        ctx.stroke()
      })
      landmarks.forEach((lm: any, idx: number) => {
        if ((lm.visibility ?? 1) < 0.5) return
        ctx.beginPath()
        ctx.arc(
          lm.x * ctx.canvas.width,
          lm.y * ctx.canvas.height,
          4,
          0,
          Math.PI * 2,
        )
        ctx.fillStyle = [25, 26, 27, 28].includes(idx) ? '#63d79b' : '#fff'
        ctx.fill()
      })
    },
    [],
  )

  useEffect(() => {
    if (!active) return
    let mounted = true

    stateRef.current = INITIAL_SQUAT_STATE
    completedRef.current = false
    setSquat(INITIAL_SQUAT_STATE)
    setPostureScore(0)
    setError(null)
    setStage('loading-model')
    setIsRearCamera(false)

    if (innerRef?.current) {
      innerRef.current.style.transform = 'none'
    }

    // Watchdog: 25 s (model is pre-loading so should be much faster)
    watchdogRef.current = setTimeout(() => {
      if (mounted) {
        setStage('error')
        setError(
          'Taking too long to load the pose model. Check your internet connection — ' +
            'it loads from cdn.jsdelivr.net and storage.googleapis.com on first use.',
        )
      }
    }, 25000)

    // ── Wide-FOV camera acquisition ──────────────────────────────────────
    // Uses the extended interface so TypeScript accepts `zoom` without errors.
    // Tries front-cam ultra-wide first, falls back gracefully.
    async function getWidestStream(): Promise<{
      stream: MediaStream
      rear: boolean
    }> {
      const attempts: Array<{
        constraints: ExtendedStreamConstraints
        rear: boolean
      }> = [
        // 1. Front cam, zoom 0.3 (ultra-wide on Chrome Android)
        {
          rear: false,
          constraints: {
            video: {
              facingMode: { ideal: 'user' },
              width: { ideal: 1080 },
              height: { ideal: 1920 },
              advanced: [{ zoom: 0.3 }],
            },
          },
        },
        // 2. Front cam, zoom 0.5
        {
          rear: false,
          constraints: {
            video: {
              facingMode: { ideal: 'user' },
              width: { ideal: 1080 },
              height: { ideal: 1920 },
              advanced: [{ zoom: 0.5 }],
            },
          },
        },
        // 3. Front cam, portrait, no zoom
        {
          rear: false,
          constraints: {
            video: {
              facingMode: 'user',
              width: { ideal: 720 },
              height: { ideal: 1280 },
            },
          },
        },
        // 4. Rear cam ultra-wide
        {
          rear: true,
          constraints: {
            video: {
              facingMode: 'environment',
              width: { ideal: 1080 },
              height: { ideal: 1920 },
              advanced: [{ zoom: 0.3 }],
            },
          },
        },
        // 5. Absolute fallback
        {
          rear: false,
          constraints: { video: {} },
        },
      ]

      for (const attempt of attempts) {
        try {
          const s = await navigator.mediaDevices.getUserMedia(
            attempt.constraints as MediaStreamConstraints,
          )

          // After getting the stream, push zoom to hardware minimum via
          // applyConstraints — more reliable than getUserMedia advanced on
          // many Android Chrome builds.
          const track = s.getVideoTracks()[0]
          if (track) {
            const caps = (track.getCapabilities?.() ?? {}) as any
            if (typeof caps.zoom?.min === 'number') {
              const hardwareMin: number = caps.zoom.min
              // Target the lowest zoom the hardware supports, max 0.4
              const targetZoom = Math.min(hardwareMin, 0.4)
              try {
                await (track.applyConstraints as any)({
                  advanced: [{ zoom: targetZoom }],
                })
              } catch {
                /* zoom not writable on this device */
              }
            }
          }

          // Detect actual facing mode from track settings
          const settings = track?.getSettings?.() ?? {}
          const actualRear =
            attempt.rear || (settings as any).facingMode === 'environment'

          return { stream: s, rear: actualRear }
        } catch {
          /* try next */
        }
      }

      // Should never reach here
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      return { stream: s, rear: false }
    }

    const init = async () => {
      try {
        // ── Model: reuse the pre-loaded promise (likely already resolved) ──
        const pose = await preloadPoseModel()
        if (!mounted) return
        poseRef.current = pose

        setStage('requesting-camera')

        // ── Camera ────────────────────────────────────────────────────────
        const { stream, rear } = await getWidestStream()

        if (!mounted || !videoRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        if (mounted) setIsRearCamera(rear)

        videoRef.current.srcObject = stream

        // Use onloadedmetadata + play() in parallel for speed
        await new Promise<void>((resolve) => {
          const v = videoRef.current!
          if (v.readyState >= 1) {
            v.play().then(resolve).catch(resolve)
          } else {
            v.onloadedmetadata = () => v.play().then(resolve).catch(resolve)
          }
        })

        if (!mounted) return

        if (canvasRef.current && videoRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth || 720
          canvasRef.current.height = videoRef.current.videoHeight || 1280
        }

        setStage('tracking')
        if (watchdogRef.current) clearTimeout(watchdogRef.current)

        let lastVideoTime = -1

        const detect = () => {
          if (
            !mounted ||
            !poseRef.current ||
            !videoRef.current ||
            !canvasRef.current
          )
            return
          const video = videoRef.current

          if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime
            try {
              const results = poseRef.current.detectForVideo(
                video,
                performance.now(),
              )
              const ctx = canvasRef.current.getContext('2d')

              if (ctx && results.landmarks?.[0]) {
                const lms = results.landmarks[0]

                // ── Posture score (throttled ~5 fps) ──────────────────────
                const now = performance.now()
                if (now - scoreTsRef.current > 200) {
                  scoreTsRef.current = now
                  const ps = computePostureScore(lms)
                  setPostureScore(ps)
                  onPostureScoreRef.current?.(ps)
                }

                // ── Squat counting ────────────────────────────────────────
                if (targetReps > 0) {
                  const lHip = lms[23],
                    lKnee = lms[25],
                    lAnkle = lms[27]
                  const rHip = lms[24],
                    rKnee = lms[26],
                    rAnkle = lms[28]
                  const lSh = lms[11],
                    rSh = lms[12]

                  const lLegVis =
                    (lHip?.visibility ?? 0) +
                    (lKnee?.visibility ?? 0) +
                    (lAnkle?.visibility ?? 0)
                  const rLegVis =
                    (rHip?.visibility ?? 0) +
                    (rKnee?.visibility ?? 0) +
                    (rAnkle?.visibility ?? 0)

                  const legOk =
                    (rLegVis > LEG_MIN_VIS && rHip && rKnee && rAnkle) ||
                    (lLegVis > LEG_MIN_VIS && lHip && lKnee && lAnkle)

                  const shVis = (lSh?.visibility ?? 0) + (rSh?.visibility ?? 0)
                  const hipVis =
                    (lHip?.visibility ?? 0) + (rHip?.visibility ?? 0)
                  const torsoOk =
                    shVis > TORSO_MIN_VIS &&
                    hipVis > TORSO_MIN_VIS &&
                    !!lSh &&
                    !!rSh &&
                    !!lHip &&
                    !!rHip

                  const canSwitch =
                    stateRef.current.phase === 'standing' ||
                    stateRef.current.phase === 'calibrating'
                  const lockedMode = canSwitch
                    ? legOk
                      ? 'angle'
                      : torsoOk
                        ? 'vertical'
                        : stateRef.current.mode
                    : stateRef.current.mode

                  let next = stateRef.current
                  if (lockedMode === 'angle' && legOk) {
                    const angle =
                      rLegVis >= lLegVis
                        ? angleDeg(rHip!, rKnee!, rAnkle!)
                        : angleDeg(lHip!, lKnee!, lAnkle!)
                    next = updateSquatStateAngle(stateRef.current, angle)
                  } else if (lockedMode === 'vertical' && torsoOk) {
                    const hipY = (lHip!.y + rHip!.y) / 2
                    const shY = (lSh!.y + rSh!.y) / 2
                    next = updateSquatStateVertical(
                      stateRef.current,
                      hipY,
                      Math.abs(hipY - shY),
                    )
                  }

                  if (next !== stateRef.current) {
                    stateRef.current = next
                    setSquat(next)
                    if (next.repCount >= targetReps && !completedRef.current) {
                      completedRef.current = true
                      setTimeout(() => onCompleteRef.current(), 600)
                    }
                  }
                }

                drawSkeleton(lms, ctx)
              } else {
                canvasRef.current
                  .getContext('2d')
                  ?.clearRect(
                    0,
                    0,
                    canvasRef.current.width,
                    canvasRef.current.height,
                  )
              }
            } catch {
              /* skip frame silently */
            }
          }

          rafRef.current = requestAnimationFrame(detect)
        }

        rafRef.current = requestAnimationFrame(detect)
      } catch (err: any) {
        if (mounted) {
          setStage('error')
          setError(
            err?.name === 'NotAllowedError'
              ? 'Camera permission denied. Allow camera access and refresh.'
              : (err?.message ?? 'Camera or pose model failed to load.'),
          )
        }
      }
    }

    init()

    return () => {
      mounted = false
      if (watchdogRef.current) clearTimeout(watchdogRef.current)
      cancelAnimationFrame(rafRef.current)
      if (videoRef.current?.srcObject)
        (videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop())
      // Don't close poseRef — it's shared via the module-level cache.
      // Closing it would break subsequent uses in the same session.
      poseRef.current = null
    }
  }, [active, targetReps, drawSkeleton, videoRef, canvasRef, innerRef])

  return { squat, postureScore, error, stage, isRearCamera }
}
