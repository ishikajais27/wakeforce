export type RepeatMode = 'none' | 'daily' | 'weekdays' | 'weekends' | 'custom'

export type TaskType = 'squats' | 'math' | 'shake'

export interface Alarm {
  id: string
  time: string // "HH:MM" 24h
  label: string
  enabled: boolean
  repeat: RepeatMode
  customDays?: number[] // 0=Sun … 6=Sat
  task: TaskType
  sound: string // filename in /sounds/
  volume: number // 0–1
  snoozeLimit: number // max snoozes allowed
  snoozeCount: number // used snoozes this cycle
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
