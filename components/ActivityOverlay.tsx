'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import CameraView from './CameraView'
import { TaskType } from '@/lib/types'

const TARGET_REPS = 15
const SHAKE_TARGET = 20

interface Props {
  task: TaskType
  onDismiss: () => void
}

export default function ActivityOverlay({ task, onDismiss }: Props) {
  const [squatsDone, setSquatsDone] = useState(false)

  const handleSquatComplete = useCallback(() => {
    setSquatsDone(true)
    onDismiss()
  }, [onDismiss])

  const [mathQ, setMathQ] = useState<{ q: string; a: number } | null>(null)
  const [mathInput, setMathInput] = useState('')
  const [mathWrong, setMathWrong] = useState(false)

  useEffect(() => {
    if (task !== 'math') return
    const a = Math.floor(Math.random() * 50) + 10
    const b = Math.floor(Math.random() * 50) + 10
    const ops = ['+', '-', '×'] as const
    const op = ops[Math.floor(Math.random() * ops.length)]
    const answer = op === '+' ? a + b : op === '-' ? a - b : a * b
    setMathQ({ q: `${a} ${op} ${b} = ?`, a: answer })
  }, [task])

  const [shakeCount, setShakeCount] = useState(0)
  const lastAcc = useRef({ x: 0, y: 0, z: 0 })

  useEffect(() => {
    if (task !== 'shake' || typeof window === 'undefined') return
    const handler = (e: DeviceMotionEvent) => {
      const { x = 0, y = 0, z = 0 } = e.accelerationIncludingGravity ?? {}
      const delta =
        Math.abs(x - lastAcc.current.x) +
        Math.abs(y - lastAcc.current.y) +
        Math.abs(z - lastAcc.current.z)
      lastAcc.current = { x: x ?? 0, y: y ?? 0, z: z ?? 0 }
      if (delta > 25) setShakeCount((n) => Math.min(n + 1, SHAKE_TARGET))
    }
    window.addEventListener('devicemotion', handler)
    return () => window.removeEventListener('devicemotion', handler)
  }, [task])

  useEffect(() => {
    if (task === 'shake' && shakeCount >= SHAKE_TARGET) onDismiss()
  }, [shakeCount, task, onDismiss])

  const handleMathSubmit = () => {
    if (Number(mathInput) === mathQ?.a) {
      onDismiss()
    } else {
      setMathWrong(true)
      setMathInput('')
      setTimeout(() => setMathWrong(false), 800)
    }
  }

  const progress = task === 'shake' ? shakeCount / SHAKE_TARGET : 0
  const R = 44
  const circ = 2 * Math.PI * R

  return (
    <div className="activity-overlay">
      <div className="activity-header">
        <h2>
          {task === 'squats' && '💪 Almost there!'}
          {task === 'math' && '🧠 Brain check!'}
          {task === 'shake' && '📳 Shake it off!'}
        </h2>
        <p className="activity-sub">
          {task === 'squats' &&
            `Do ${TARGET_REPS} squats to turn off the alarm`}
          {task === 'math' && 'Solve this to turn off the alarm'}
          {task === 'shake' && 'Shake your phone to turn off the alarm'}
        </p>
        {task === 'squats' && (
          <p className="activity-hint">
            🧍 Stand back so your whole body fits in frame
          </p>
        )}
      </div>

      {task === 'squats' && !squatsDone && (
        <CameraView
          active
          targetReps={TARGET_REPS}
          onComplete={handleSquatComplete}
        />
      )}

      {task === 'math' && mathQ && (
        <div className="math-puzzle">
          <div className="math-question">{mathQ.q}</div>
          <input
            type="number"
            inputMode="numeric"
            value={mathInput}
            onChange={(e) => setMathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleMathSubmit()}
            className={`math-input ${mathWrong ? 'shake-err' : ''}`}
            autoFocus
            placeholder="Your answer"
          />
          <button className="btn-primary" onClick={handleMathSubmit}>
            Confirm
          </button>
          {mathWrong && <p className="math-wrong">Wrong — try again</p>}
        </div>
      )}

      {task === 'shake' && (
        <div className="shake-wrap">
          <svg
            width="110"
            height="110"
            viewBox="0 0 110 110"
            aria-hidden="true"
          >
            <circle
              cx="55"
              cy="55"
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="8"
            />
            <circle
              cx="55"
              cy="55"
              r={R}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="8"
              strokeDasharray={`${circ * progress} ${circ * (1 - progress)}`}
              strokeLinecap="round"
              strokeDashoffset={circ * 0.25}
              style={{ transition: 'stroke-dasharray 0.2s ease' }}
            />
            <text
              x="55"
              y="60"
              textAnchor="middle"
              fill="#fff"
              fontSize="22"
              fontWeight="700"
            >
              {shakeCount}
            </text>
          </svg>
          <p className="shake-hint">
            Shake {SHAKE_TARGET - shakeCount} more times
          </p>
        </div>
      )}
    </div>
  )
}
