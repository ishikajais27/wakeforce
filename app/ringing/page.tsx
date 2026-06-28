'use client'

import { useEffect, useRef, useState } from 'react'
import { useAlarms } from '@/context/AlarmContext'
import { Alarm } from '@/lib/types'
import { createAlarmSound, AlarmSoundHandle } from '@/lib/alarmSound'
import RingingPulse from '@/components/RingingPulse'
import ActivityOverlay from '@/components/ActivityOverlay'

const FIRING_KEY = 'wakeforce_firing'

// ── Kick off MediaPipe preload the instant this page module is parsed ──
// By the time the user taps "Let's go", the model is already downloaded.
if (typeof window !== 'undefined') {
  import('@mediapipe/tasks-vision')
    .then(({ FilesetResolver, PoseLandmarker }) => {
      FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
      )
        .then((vision) => {
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
          }).catch(() => {
            /* silent — will retry in hook */
          })
        })
        .catch(() => {})
    })
    .catch(() => {})
}

export default function RingingPage() {
  const { snooze, dismiss } = useAlarms()
  const soundRef = useRef<AlarmSoundHandle | null>(null)
  const [taskActive, setTaskActive] = useState(false)
  const [displayTime, setDisplayTime] = useState('')
  const [alarm, setAlarm] = useState<Alarm | null>(null)
  const [audioStarted, setAudioStarted] = useState(false)

  // ── Load alarm data immediately ────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(FIRING_KEY)
    if (!raw) {
      window.location.href = '/'
      return
    }
    try {
      setAlarm(JSON.parse(raw) as Alarm)
    } catch {
      localStorage.removeItem(FIRING_KEY)
      window.location.href = '/'
    }
  }, [])

  // ── Clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () =>
      setDisplayTime(
        new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
      )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Sound: create + attempt autoplay the instant alarm data is ready ───
  // On mobile, autoplay is blocked until a user gesture. We attempt it
  // immediately anyway — if it works (some browsers allow it for alarm-type
  // pages), great. If not, the "tap anywhere" hint guides them.
  useEffect(() => {
    if (!alarm) return

    const handle = createAlarmSound(alarm.sound, alarm.volume ?? 0.8)
    soundRef.current = handle

    // Try to start immediately (works on Android Chrome in many cases)
    handle.start().then((started) => {
      setAudioStarted(started)
    })

    return () => {
      handle.stop()
      soundRef.current = null
    }
  }, [alarm])

  // ── Tap-to-unlock audio (Safari / strict autoplay policy) ─────────────
  const startAudio = () => {
    if (audioStarted) return
    soundRef.current?.start().then(setAudioStarted)
  }

  const stopAudio = () => {
    soundRef.current?.stop()
    soundRef.current = null
  }

  if (!alarm) {
    return (
      <div className="ringing-loading">
        <div className="ringing-loading-spinner" />
      </div>
    )
  }

  const snoozesLeft = alarm.snoozeLimit - alarm.snoozeCount

  return (
    <div className="ringing-page" onClick={startAudio}>
      <RingingPulse />

      <div className="ringing-content">
        <div className="ringing-mascot">⏰</div>
        <span className="ringing-label">{alarm.label || 'Wake up!'}</span>
        <div className="ringing-time">{displayTime}</div>

        {!audioStarted && (
          <p className="ringing-tap-hint">👆 Tap anywhere to start the sound</p>
        )}

        <div className="ringing-actions">
          <button
            className="btn-snooze"
            disabled={snoozesLeft <= 0}
            onClick={(e) => {
              e.stopPropagation()
              stopAudio()
              snooze()
            }}
          >
            😴 Snooze {snoozesLeft > 0 ? `(${snoozesLeft}×)` : ''}
          </button>

          <button
            className="btn-start-task"
            onClick={(e) => {
              e.stopPropagation()
              setTaskActive(true)
            }}
          >
            Let's go →
          </button>
        </div>
      </div>

      {taskActive && (
        <ActivityOverlay
          task={alarm.task}
          onDismiss={() => {
            stopAudio()
            dismiss()
          }}
        />
      )}
    </div>
  )
}
