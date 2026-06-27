'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAlarms } from '@/context/AlarmContext'
import { Alarm, RepeatMode, TaskType } from '@/lib/types'
import { DAY_NAMES } from '@/lib/alarmUtils'
import { registerCustomSound } from '@/lib/alarmSound'

const TASKS: { value: TaskType; label: string; icon: string; desc: string }[] =
  [
    {
      value: 'squats',
      label: '15 Squats',
      icon: '🏋️',
      desc: 'Full squat via camera',
    },
    {
      value: 'math',
      label: 'Math puzzle',
      icon: '🧮',
      desc: 'Solve arithmetic',
    },
    {
      value: 'shake',
      label: 'Shake phone',
      icon: '📳',
      desc: 'Shake device hard',
    },
    {
      value: 'posture',
      label: 'Good posture',
      icon: '🧍',
      desc: 'Hold straight 10 s',
    },
  ]

const PRESET_SOUNDS = [
  { value: 'alarm-gentle', label: 'Gentle' },
  { value: 'alarm-digital', label: 'Digital' },
  { value: 'alarm-loud', label: 'Loud' },
  { value: 'alarm-chime', label: 'Chime' },
]

const REPEATS: RepeatMode[] = [
  'none',
  'daily',
  'weekdays',
  'weekends',
  'custom',
]

const DEFAULT: Omit<Alarm, 'id' | 'snoozeCount'> = {
  time: '07:00',
  label: '',
  enabled: true,
  repeat: 'daily',
  customDays: [],
  task: 'squats',
  sound: 'alarm-gentle',
  volume: 0.8,
  snoozeLimit: 2,
  snoozeDuration: 5,
}

export default function AlarmForm() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')
  const { alarms, addAlarm, updateAlarm } = useAlarms()

  const [form, setForm] = useState<Omit<Alarm, 'id' | 'snoozeCount'>>(DEFAULT)
  const [customFileName, setCustomFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editId) {
      const found = alarms.find((a) => a.id === editId)
      if (found) {
        const { id, snoozeCount, ...rest } = found
        setForm(rest)
        if (rest.sound.startsWith('custom:'))
          setCustomFileName(rest.sound.slice(7))
      }
    }
  }, [editId, alarms])

  const set = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: val }))

  const toggleCustomDay = (d: number) => {
    const days = form.customDays ?? []
    set(
      'customDays',
      days.includes(d) ? days.filter((x) => x !== d) : [...days, d],
    )
  }

  const handleSoundFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    file.arrayBuffer().then((buf) => {
      registerCustomSound(file.name, buf)
      set('sound', `custom:${file.name}`)
      setCustomFileName(file.name)
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editId) {
      updateAlarm(editId, form)
    } else {
      addAlarm(form)
    }
    router.push('/')
  }

  const isCustomSound = form.sound.startsWith('custom:')

  return (
    <form className="alarm-form" onSubmit={handleSubmit}>
      {/* Time */}
      <div className="form-group">
        <label>Wake-up time</label>
        <input
          type="time"
          value={form.time}
          onChange={(e) => set('time', e.target.value)}
          required
          className="time-input"
        />
      </div>

      {/* Label */}
      <div className="form-group">
        <label>Label</label>
        <input
          type="text"
          value={form.label}
          onChange={(e) => set('label', e.target.value)}
          placeholder="Morning workout, Work shift…"
          maxLength={40}
        />
      </div>

      {/* Repeat */}
      <div className="form-group">
        <label>Repeat</label>
        <div className="chip-row">
          {REPEATS.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip ${form.repeat === r ? 'active' : ''}`}
              onClick={() => set('repeat', r)}
            >
              {r === 'none' ? 'Once' : r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
        {form.repeat === 'custom' && (
          <div className="chip-row day-row" style={{ marginTop: 8 }}>
            {DAY_NAMES.map((name, i) => (
              <button
                key={i}
                type="button"
                className={`chip day-chip ${form.customDays?.includes(i) ? 'active' : ''}`}
                onClick={() => toggleCustomDay(i)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Wake-up Task */}
      <div className="form-group">
        <label>Wake-up task</label>
        <div className="task-row">
          {TASKS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`task-card ${form.task === t.value ? 'active' : ''}`}
              onClick={() => set('task', t.value)}
            >
              <span className="task-icon">{t.icon}</span>
              <span className="task-label">{t.label}</span>
              <span className="task-desc">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sound */}
      <div className="form-group">
        <label>Alarm sound</label>

        {/* Preset chips */}
        <div className="chip-row">
          {PRESET_SOUNDS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`chip ${form.sound === s.value ? 'active' : ''}`}
              onClick={() => {
                set('sound', s.value)
                setCustomFileName(null)
              }}
            >
              {s.label}
            </button>
          ))}
          {/* Custom chip */}
          <button
            type="button"
            className={`chip ${isCustomSound ? 'active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            📁 {customFileName ? customFileName.slice(0, 18) : 'Upload…'}
          </button>
        </div>

        {/* Hidden file picker — audio only, stored in memory */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleSoundFile}
        />

        {isCustomSound && (
          <p className="form-hint">
            ✅ Custom sound loaded. Note: re-select the file after a page
            refresh.
          </p>
        )}
      </div>

      {/* Volume */}
      <div className="form-group">
        <label>Volume — {Math.round(form.volume * 100)}%</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={form.volume}
          onChange={(e) => set('volume', Number(e.target.value))}
        />
      </div>

      {/* Snooze limit */}
      <div className="form-group">
        <label>Snooze limit — {form.snoozeLimit}×</label>
        <input
          type="range"
          min="0"
          max="5"
          step="1"
          value={form.snoozeLimit}
          onChange={(e) => set('snoozeLimit', Number(e.target.value))}
        />
      </div>

      {/* Snooze duration */}
      <div className="form-group">
        <label>Snooze / remind-me duration — {form.snoozeDuration} min</label>
        <input
          type="range"
          min="1"
          max="30"
          step="1"
          value={form.snoozeDuration}
          onChange={(e) => set('snoozeDuration', Number(e.target.value))}
        />
        <p className="form-hint">
          When you snooze or tap "Remind me later", the alarm re-arms after this
          many minutes.
        </p>
      </div>

      <button type="submit" className="btn-primary full-width">
        {editId ? 'Save changes' : 'Set alarm'}
      </button>
    </form>
  )
}
