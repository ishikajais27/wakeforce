export type TaskType = 'squats' | 'math' | 'shake' | 'posture'
export type RepeatMode = 'none' | 'daily' | 'weekdays' | 'weekends' | 'custom'

export interface Alarm {
  id: string
  time: string
  label: string
  enabled: boolean
  repeat: RepeatMode
  customDays: number[]
  task: TaskType
  /** Preset name (alarm-gentle / alarm-digital / alarm-loud / alarm-chime)
   *  or 'custom:<filename>' for user-uploaded audio (stored in memory). */
  sound: string
  volume: number
  snoozeLimit: number
  snoozeCount: number
  /** How many minutes to snooze — user-configurable, default 5 */
  snoozeDuration: number
}

export interface AlarmContextValue {
  alarms: Alarm[]
  addAlarm: (a: Omit<Alarm, 'id' | 'snoozeCount'>) => void
  updateAlarm: (id: string, patch: Partial<Alarm>) => void
  deleteAlarm: (id: string) => void
  firingAlarm: Alarm | null
  snooze: () => void
  dismiss: () => void
}
