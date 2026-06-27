'use client'

import { useRef } from 'react'
import { usePoseDetection } from '@/hooks/usePoseDetection'

interface Props {
  active: boolean
  targetReps: number
  onComplete: () => void
}

export default function CameraView({ active, targetReps, onComplete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { squat, error, stage } = usePoseDetection({
    videoRef,
    canvasRef,
    active,
    targetReps,
    onComplete,
  })

  const phaseLabel =
    squat.phase === 'calibrating'
      ? 'Hold still…'
      : squat.phase === 'bottom'
        ? '⬇ Go up!'
        : '⬆ Squat down'

  return (
    <div className="camera-wrap">
      {error ? (
        <div className="camera-error">
          <p>🚫 {error}</p>
          <p className="hint">Grant camera access and refresh.</p>
        </div>
      ) : (
        <>
          {/* No hardcoded width/height — canvas resolution is set in JS to
              match the camera's real resolution; CSS handles display size */}
          <video ref={videoRef} className="camera-feed" playsInline muted />
          <canvas ref={canvasRef} className="camera-canvas" />

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
              <div className="camera-badge">
                {squat.repCount}/{targetReps}&nbsp;{phaseLabel}
              </div>
              {squat.mode === 'vertical' && (
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
