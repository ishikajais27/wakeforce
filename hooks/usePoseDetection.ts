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
  /** Prefer rear (environment) camera for wider field-of-view.
   *  Recommended for squats; front camera preferred for posture. */
  preferEnvironment?: boolean
}

const LEG_MIN_VIS = 0.9
const TORSO_MIN_VIS = 0.6

// ── Module-level model cache ───────────────────────────────────────────────
let _posePromise: Promise<any> | null = null

function preloadPoseModel() {
  if (_posePromise) return _posePromise
  _posePromise = (async () => {
    const { PoseLandmarker, FilesetResolver } =
      await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
    )
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    })
  })()
  _posePromise.catch(() => {
    _posePromise = null
  })
  return _posePromise
}

if (typeof window !== 'undefined') {
  preloadPoseModel().catch(() => {})
}

// ── Push zoom to hardware minimum for widest FOV ──────────────────────────
async function applyMinZoom(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0]
  if (!track) return
  const caps = (track.getCapabilities?.() ?? {}) as any
  if (typeof caps.zoom?.min === 'number') {
    try {
      await (track.applyConstraints as any)({
        advanced: [{ zoom: caps.zoom.min }],
      })
    } catch {
      /* zoom constraint not writable */
    }
  }
}

// ── Find the widest-FOV camera ────────────────────────────────────────────
async function getWidestFOVStream(preferEnvironment = false): Promise<{
  stream: MediaStream
  rear: boolean
}> {
  const primaryFacing = preferEnvironment ? 'environment' : 'user'
  const fallbackFacing = preferEnvironment ? 'user' : 'environment'

  // ── Step 1: get permission with preferred facing mode ─────────────────
  let permStream: MediaStream
  try {
    permStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: primaryFacing },
    })
  } catch {
    try {
      permStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: fallbackFacing },
      })
    } catch {
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      return { stream: s, rear: false }
    }
  }

  // ── Step 2: enumerate video input devices ─────────────────────────────
  let devices: MediaDeviceInfo[] = []
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    devices = all.filter((d) => d.kind === 'videoinput')
  } catch {
    await applyMinZoom(permStream)
    return {
      stream: permStream,
      rear: preferEnvironment,
    }
  }

  permStream.getTracks().forEach((t) => t.stop())

  if (devices.length === 0) {
    const s = await navigator.mediaDevices.getUserMedia({ video: true })
    return { stream: s, rear: false }
  }

  // ── Step 3: probe each device for capabilities ────────────────────────
  interface DeviceScore {
    deviceId: string
    label: string
    minZoom: number
    maxWidth: number
    isFront: boolean
    isRear: boolean
  }

  const scores: DeviceScore[] = []

  for (const device of devices) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: device.deviceId },
          width: { ideal: 1080 },
          height: { ideal: 1920 },
        },
      })
      const track = probe.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as any
      const settings = (track.getSettings?.() ?? {}) as any

      const minZoom: number =
        typeof caps.zoom?.min === 'number' ? caps.zoom.min : 999
      const maxWidth: number =
        typeof caps.width?.max === 'number' ? caps.width.max : 0
      const facingMode: string = settings.facingMode ?? ''
      const label = device.label.toLowerCase()

      const isFront =
        facingMode === 'user' ||
        label.includes('front') ||
        label.includes('selfie') ||
        label.includes('facing front')

      const isRear =
        facingMode === 'environment' ||
        label.includes('back') ||
        label.includes('rear') ||
        label.includes('facing back') ||
        label.includes('environment')

      scores.push({
        deviceId: device.deviceId,
        label: device.label,
        minZoom,
        maxWidth,
        isFront,
        isRear,
      })

      probe.getTracks().forEach((t) => t.stop())
    } catch {
      /* device not accessible — skip */
    }
  }

  if (scores.length === 0) {
    const s = await navigator.mediaDevices.getUserMedia({ video: true })
    return { stream: s, rear: false }
  }

  // ── Step 4: select best candidate ─────────────────────────────────────
  // If preferEnvironment, rank rear cameras first; otherwise front cameras.
  const preferredPool = preferEnvironment
    ? scores.filter((s) => s.isRear)
    : scores.filter((s) => s.isFront)

  const pool = preferredPool.length > 0 ? preferredPool : scores

  // Sort: lowest minZoom first (widest FOV), then highest maxWidth
  pool.sort((a, b) => {
    if (a.minZoom !== b.minZoom) return a.minZoom - b.minZoom
    return b.maxWidth - a.maxWidth
  })

  const best = pool[0]
  const isRear = best.isRear || (!best.isFront && preferEnvironment)

  // ── Step 5: open best device at full portrait resolution ──────────────
  let finalStream: MediaStream
  try {
    finalStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: best.deviceId },
        width: { ideal: 1080 },
        height: { ideal: 1920 },
        aspectRatio: { ideal: 9 / 16 },
      },
    })
  } catch {
    finalStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: isRear ? 'environment' : 'user',
        width: { ideal: 1080 },
        height: { ideal: 1920 },
      },
    })
  }

  await applyMinZoom(finalStream)

  return { stream: finalStream, rear: isRear }
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function usePoseDetection({
  videoRef,
  canvasRef,
  innerRef,
  active,
  targetReps,
  onComplete,
  onPostureScore,
  preferEnvironment = false,
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
  // Track last drawn landmarks to skip redundant redraws
  const lastLandmarkHashRef = useRef(0)

  useEffect(() => {
    onCompleteRef.current = onComplete
  })
  useEffect(() => {
    onPostureScoreRef.current = onPostureScore
  })

  /** Cheap hash of landmark positions to detect movement */
  const landmarkHash = useCallback((landmarks: any[]): number => {
    let h = 0
    // Sample every 4th landmark for speed
    for (let i = 0; i < landmarks.length; i += 4) {
      const lm = landmarks[i]
      if (!lm) continue
      h = ((((h * 31 + lm.x * 1000) | 0) * 31 + lm.y * 1000) | 0) & 0x7fffffff
    }
    return h
  }, [])

  const drawSkeleton = useCallback(
    (landmarks: any[], ctx: CanvasRenderingContext2D) => {
      const hash = landmarkHash(landmarks)
      // Skip redraw if landmarks haven't changed meaningfully
      if (hash === lastLandmarkHashRef.current) return
      lastLandmarkHashRef.current = hash

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
    [landmarkHash],
  )

  useEffect(() => {
    if (!active) return
    let mounted = true

    stateRef.current = INITIAL_SQUAT_STATE
    completedRef.current = false
    lastLandmarkHashRef.current = 0
    setSquat(INITIAL_SQUAT_STATE)
    setPostureScore(0)
    setError(null)
    setStage('loading-model')
    setIsRearCamera(false)

    if (innerRef?.current) {
      innerRef.current.style.transform = 'none'
    }

    watchdogRef.current = setTimeout(() => {
      if (mounted) {
        setStage('error')
        setError(
          'Taking too long to load. Check your internet connection and camera permissions.',
        )
      }
    }, 30_000)

    const init = async () => {
      try {
        // ── Model (uses cache — fast after first load) ─────────────────
        const pose = await preloadPoseModel()
        if (!mounted) return
        poseRef.current = pose

        setStage('requesting-camera')

        // ── Camera: pick widest-FOV device ────────────────────────────
        const { stream, rear } = await getWidestFOVStream(preferEnvironment)

        if (!mounted || !videoRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        setIsRearCamera(rear)
        videoRef.current.srcObject = stream

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
          canvasRef.current.width = videoRef.current.videoWidth || 1080
          canvasRef.current.height = videoRef.current.videoHeight || 1920
        }

        setStage('tracking')
        if (watchdogRef.current) clearTimeout(watchdogRef.current)

        let lastVideoTime = -1

        const detect = () => {
          if (!mounted) return

          // Pause processing when the screen/tab is hidden
          if (document.hidden) {
            rafRef.current = requestAnimationFrame(detect)
            return
          }

          if (!poseRef.current || !videoRef.current || !canvasRef.current) {
            rafRef.current = requestAnimationFrame(detect)
            return
          }

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

                // ── Posture score (throttled to every 200 ms) ──────────
                const now = performance.now()
                if (now - scoreTsRef.current > 200) {
                  scoreTsRef.current = now
                  const ps = computePostureScore(lms)
                  setPostureScore(ps)
                  onPostureScoreRef.current?.(ps)
                }

                // ── Squat rep counting ─────────────────────────────────
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
                const ctx2d = canvasRef.current?.getContext('2d')
                if (ctx2d) {
                  ctx2d.clearRect(
                    0,
                    0,
                    canvasRef.current!.width,
                    canvasRef.current!.height,
                  )
                }
                lastLandmarkHashRef.current = 0
              }
            } catch {
              /* skip frame on error */
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
      if (videoRef.current?.srcObject) {
        ;(videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop())
        videoRef.current.srcObject = null
      }
      poseRef.current = null
    }
  }, [
    active,
    targetReps,
    preferEnvironment,
    drawSkeleton,
    videoRef,
    canvasRef,
    innerRef,
  ])

  return { squat, postureScore, error, stage, isRearCamera }
}
