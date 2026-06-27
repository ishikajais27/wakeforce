'use client'

import Link from 'next/link'
import { useAlarms } from '@/context/AlarmContext'
import { DAY_LABELS } from '@/lib/alarmUtils'
import { Alarm } from '@/lib/types'

const TASK_ICONS: Record<string, string> = {
  squats: '🏋️',
  math: '🧮',
  shake: '📳',
}

export default function AlarmList() {
  const { alarms, updateAlarm, deleteAlarm } = useAlarms()

  if (alarms.length === 0) {
    return (
      <div className="alarm-empty">
        <p>No alarms set.</p>
        <Link href="/set" className="btn-primary">
          Set your first alarm
        </Link>
      </div>
    )
  }

  return (
    <ul className="alarm-list">
      {alarms.map((alarm) => (
        <AlarmCard
          key={alarm.id}
          alarm={alarm}
          onToggle={(val) => updateAlarm(alarm.id, { enabled: val })}
          onDelete={() => deleteAlarm(alarm.id)}
        />
      ))}
    </ul>
  )
}

function AlarmCard({
  alarm,
  onToggle,
  onDelete,
}: {
  alarm: Alarm
  onToggle: (v: boolean) => void
  onDelete: () => void
}) {
  const [h, m] = alarm.time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  const displayTime = `${h12}:${String(m).padStart(2, '0')}`

  return (
    <li className={`alarm-card ${alarm.enabled ? 'enabled' : 'disabled'}`}>
      <div className="alarm-card__left">
        <span className="alarm-card__time">
          {displayTime}
          <sup className="alarm-card__period">{period}</sup>
        </span>
        <span className="alarm-card__label">{alarm.label || 'Alarm'}</span>
        <div className="alarm-card__meta">
          <span className="alarm-card__task">
            {TASK_ICONS[alarm.task]} {alarm.task}
          </span>
          {alarm.repeat !== 'none' && (
            <span className="alarm-card__repeat">
              {alarm.repeat === 'custom'
                ? (alarm.customDays ?? []).map((d) => DAY_LABELS[d]).join(' ')
                : alarm.repeat}
            </span>
          )}
        </div>
      </div>
      <div className="alarm-card__right">
        <button
          className={`toggle ${alarm.enabled ? 'on' : 'off'}`}
          onClick={() => onToggle(!alarm.enabled)}
          aria-label={alarm.enabled ? 'Disable alarm' : 'Enable alarm'}
        >
          <span className="toggle__thumb" />
        </button>
        <Link
          href={`/set?id=${alarm.id}`}
          className="icon-btn"
          aria-label="Edit alarm"
        >
          ✏️
        </Link>
        <button
          className="icon-btn danger"
          onClick={onDelete}
          aria-label="Delete alarm"
        >
          🗑
        </button>
      </div>
    </li>
  )
}
