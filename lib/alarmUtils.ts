import { Alarm, RepeatMode } from './types'

export function getNextFireMs(alarm: Alarm): number | null {
  if (!alarm || !alarm.enabled || !alarm.time) return null
  const [h, m] = alarm.time.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null

  const now = new Date()
  const candidate = new Date(now)
  candidate.setHours(h, m, 0, 0)
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1)

  if (alarm.repeat === 'none') return candidate.getTime() - now.getTime()

  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(candidate)
    day.setDate(candidate.getDate() + offset)
    const dow = day.getDay()
    if (shouldFireOnDay(alarm.repeat, alarm.customDays ?? [], dow))
      return day.getTime() - now.getTime()
  }
  return null
}

function shouldFireOnDay(
  repeat: RepeatMode,
  customDays: number[],
  dow: number,
): boolean {
  if (repeat === 'daily') return true
  if (repeat === 'weekdays') return dow >= 1 && dow <= 5
  if (repeat === 'weekends') return dow === 0 || dow === 6
  if (repeat === 'custom') return customDays.includes(dow)
  return false
}

export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
