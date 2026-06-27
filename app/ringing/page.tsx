'use client'

import { useEffect, useRef, useState } from 'react'
import { useAlarms } from '@/context/AlarmContext'
import { Alarm } from '@/lib/types'
import { createAlarmSound, AlarmSoundHandle } from '@/lib/alarmSound'
import RingingPulse from '@/components/RingingPulse'
import ActivityOverlay from '@/components/ActivityOverlay'

const FIRING_KEY = 'wakeforce_firing'

export default function RingingPage() {
  const { snooze, dismiss } = useAlarms()
  const soundRef = useRef<AlarmSoundHandle | null>(null)
  const [taskActive, setTaskActive] = useState(false)
  const [displayTime, setDisplayTime] = useState('')
  const [alarm, setAlarm] = useState<Alarm | null>(null)
  const [audioStarted, setAudioStarted] = useState(false)

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

  // KEY FIX: sound is generated live with Web Audio instead of playing a
  // .mp3 that never existed in /public/sounds. start() also tells us
  // honestly whether the browser actually let it play.
  useEffect(() => {
    if (!alarm) return
    const handle = createAlarmSound(alarm.sound, alarm.volume ?? 0.8)
    soundRef.current = handle
    handle.start().then(setAudioStarted)
    return () => {
      handle.stop()
      soundRef.current = null
    }
  }, [alarm])

  const startAudio = () => {
    soundRef.current?.start().then(setAudioStarted)
  }

  const stopAudio = () => {
    soundRef.current?.stop()
    soundRef.current = null
  }

  if (!alarm) {
    return <div className="ringing-loading">Loading…</div>
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
