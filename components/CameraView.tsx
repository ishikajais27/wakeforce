'use client'

import { memo, useRef } from 'react'
import { usePoseDetection } from '@/hooks/usePoseDetection'
import { postureColor, postureLabel } from '@/lib/poseUtils'

interface Props {
  active: boolean
  targetReps: number
  onComplete: () => void
  onPostureScore?: (score: number) => void
  /** Use rear (environment) camera for wider field-of-view */
  preferEnvironment?: boolean
}

const CameraView = memo(function CameraView({
  active,
  targetReps,
  onComplete,
  onPostureScore,
  preferEnvironment = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const { squat, postureScore, error, stage, isRearCamera } = usePoseDetection({
    videoRef,
    canvasRef,
    innerRef,
    active,
    targetReps,
    onComplete,
    onPostureScore,
    preferEnvironment,
  })

  const isPostureMode = targetReps === 0
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
          <p style={{ fontSize: 32 }}>🚫</p>
          <p>{error}</p>
          <p className="hint">Grant camera access and refresh.</p>
        </div>
      ) : (
        <>
          <div ref={innerRef} className="camera-inner">
            <video
              ref={videoRef}
              className={`camera-feed${isRearCamera ? ' rear-camera' : ''}`}
              playsInline
              muted
              autoPlay
            />
            <canvas
              ref={canvasRef}
              className={`camera-canvas${isRearCamera ? ' rear-camera' : ''}`}
            />
          </div>

          {stage !== 'tracking' && (
            <div className="camera-loading">
              <div className="camera-spinner" />
              <p>
                {stage === 'loading-model' && 'Loading pose model…'}
                {stage === 'requesting-camera' && 'Starting camera…'}
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
                <div className="camera-tip">Tracking via body movement</div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
})

export default CameraView
