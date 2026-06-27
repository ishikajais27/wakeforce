'use client'

import { useRef, useEffect } from 'react'
import { usePoseDetection } from '@/hooks/usePoseDetection'
import { postureColor, postureLabel } from '@/lib/poseUtils'

interface Props {
  active: boolean
  targetReps: number
  onComplete: () => void
  onPostureScore?: (score: number) => void
}

export default function CameraView({
  active,
  targetReps,
  onComplete,
  onPostureScore,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null) // NEW

  const { squat, postureScore, error, stage } = usePoseDetection({
    videoRef,
    canvasRef,
    innerRef,
    active,
    targetReps,
    onComplete,
    onPostureScore,
  })

  // NEW: once video metadata is known, resize the container to match exactly
  // so there are zero black bars regardless of landscape / portrait / any camera
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => {
      if (!video.videoWidth || !wrapRef.current) return
      // Set aspect-ratio so CSS handles the sizing; height drives width
      wrapRef.current.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`
    }
    video.addEventListener('loadedmetadata', sync)
    if (video.readyState >= 1) sync() // already loaded
    return () => video.removeEventListener('loadedmetadata', sync)
  }, [active])

  const isPostureMode = targetReps === 0
  const phaseLabel =
    squat.phase === 'calibrating'
      ? 'Hold still…'
      : squat.phase === 'bottom'
        ? '⬇ Go up!'
        : '⬆ Squat down'

  return (
    <div ref={wrapRef} className="camera-wrap">
      {error ? (
        <div className="camera-error">
          <p>🚫 {error}</p>
          <p className="hint">Grant camera access and refresh.</p>
        </div>
      ) : (
        <>
          <div ref={innerRef} className="camera-inner">
            <video ref={videoRef} className="camera-feed" playsInline muted />
            <canvas ref={canvasRef} className="camera-canvas" />
          </div>

          {stage !== 'tracking' && (
            <div className="camera-loading">
              <div className="camera-spinner" />
              <p>
                {stage === 'loading-model' && 'Loading pose model…'}
                {stage === 'requesting-camera' && 'Requesting camera access…'}
              </p>
            </div>
          )}

          {stage === 'tracking' && (
            <>
              {isPostureMode ? (
                <div
                  className="camera-badge"
                  style={{
                    color: postureColor(postureScore),
                    borderColor: postureColor(postureScore),
                  }}
                >
                  {postureScore}/100 — {postureLabel(postureScore)}
                </div>
              ) : (
                <div className="camera-badge">
                  {squat.repCount}/{targetReps}&nbsp;{phaseLabel}
                </div>
              )}
              {!isPostureMode && squat.mode === 'vertical' && (
                <div className="camera-tip">
                  Tracking via body movement — legs not in frame
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
