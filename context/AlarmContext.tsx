'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  ReactNode,
} from 'react'
import { Alarm, AlarmContextValue } from '@/lib/types'

const Ctx = createContext<AlarmContextValue | null>(null)
const STORAGE_KEY = 'wakeforce_alarms'
const FIRING_KEY = 'wakeforce_firing'
const SNOOZE_KEY = 'wakeforce_snooze'
const FIRED_LOG_KEY = 'wakeforce_fired_log'

function load(): Alarm[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function save(alarms: Alarm[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms))
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function shouldFireNow(alarm: Alarm): boolean {
  if (!alarm.enabled) return false
  const now = new Date()
  const [h, m] = alarm.time.split(':').map(Number)
  if (now.getHours() !== h || now.getMinutes() !== m) return false
  const dow = now.getDay()
  if (alarm.repeat === 'none') return true
  if (alarm.repeat === 'daily') return true
  if (alarm.repeat === 'weekdays') return dow >= 1 && dow <= 5
  if (alarm.repeat === 'weekends') return dow === 0 || dow === 6
  if (alarm.repeat === 'custom') return (alarm.customDays ?? []).includes(dow)
  return false
}

function minuteKeyFor(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}_${d.getHours()}:${d.getMinutes()}`
}

function loadFiredLog(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const arr = JSON.parse(
      localStorage.getItem(FIRED_LOG_KEY) ?? '[]',
    ) as string[]
    return new Set(arr)
  } catch {
    return new Set()
  }
}

function saveFiredLog(set: Set<string>) {
  localStorage.setItem(
    FIRED_LOG_KEY,
    JSON.stringify(Array.from(set).slice(-30)),
  )
}

export function AlarmProvider({ children }: { children: ReactNode }) {
  const [alarms, setAlarms] = useState<Alarm[]>([])
  const [firingAlarm, setFiringAlarm] = useState<Alarm | null>(null)
  const alarmsRef = useRef<Alarm[]>([])

  useEffect(() => {
    const loaded = load()
    setAlarms(loaded)
    alarmsRef.current = loaded
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem(FIRING_KEY)
    if (!raw) return
    if (window.location.pathname === '/ringing') {
      try {
        setFiringAlarm(JSON.parse(raw) as Alarm)
      } catch {
        localStorage.removeItem(FIRING_KEY)
      }
    } else {
      localStorage.removeItem(FIRING_KEY)
    }
  }, [])

  const persist = useCallback((next: Alarm[]) => {
    alarmsRef.current = next
    setAlarms(next)
    save(next)
  }, [])

  // ── Alarm check runs every 5 s ─────────────────────────────────────────
  useEffect(() => {
    const check = () => {
      if (typeof window === 'undefined') return
      const onRingingPage = window.location.pathname === '/ringing'

      // ── Pending snooze ───────────────────────────────────────────────
      const snoozeRaw = localStorage.getItem(SNOOZE_KEY)
      if (snoozeRaw) {
        try {
          const { alarm, fireAt } = JSON.parse(snoozeRaw) as {
            alarm: Alarm
            fireAt: number
          }
          if (Date.now() >= fireAt) {
            localStorage.removeItem(SNOOZE_KEY)
            if (!onRingingPage) {
              localStorage.setItem(FIRING_KEY, JSON.stringify(alarm))
              setFiringAlarm(alarm)
              window.location.href = '/ringing'
            }
            return
          }
        } catch {
          localStorage.removeItem(SNOOZE_KEY)
        }
      }

      if (onRingingPage) return

      // ── Normal scheduled alarms ──────────────────────────────────────
      const now = new Date()
      const keyBase = minuteKeyFor(now)
      const fired = loadFiredLog()

      for (const alarm of alarmsRef.current) {
        const fireKey = `${alarm.id}_${keyBase}`
        if (fired.has(fireKey)) continue

        if (shouldFireNow(alarm)) {
          fired.add(fireKey)
          saveFiredLog(fired)
          localStorage.setItem(FIRING_KEY, JSON.stringify(alarm))
          setFiringAlarm(alarm)
          window.location.replace('/ringing')
          return
        }
      }
    }

    check()
    const id = setInterval(check, 5_000)
    return () => clearInterval(id)
  }, [])

  const addAlarm = useCallback(
    (a: Omit<Alarm, 'id' | 'snoozeCount'>) => {
      const alarm: Alarm = { ...a, id: uid(), snoozeCount: 0 }
      persist([...alarmsRef.current, alarm])
    },
    [persist],
  )

  const updateAlarm = useCallback(
    (id: string, patch: Partial<Alarm>) => {
      persist(
        alarmsRef.current.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      )
    },
    [persist],
  )

  const deleteAlarm = useCallback(
    (id: string) => {
      persist(alarmsRef.current.filter((a) => a.id !== id))
    },
    [persist],
  )

  const snooze = useCallback(() => {
    if (!firingAlarm) return
    if (firingAlarm.snoozeCount >= firingAlarm.snoozeLimit) return
    const snoozed = {
      ...firingAlarm,
      snoozeCount: firingAlarm.snoozeCount + 1,
    }
    updateAlarm(firingAlarm.id, { snoozeCount: snoozed.snoozeCount })
    localStorage.setItem(
      SNOOZE_KEY,
      JSON.stringify({
        alarm: snoozed,
        fireAt: Date.now() + (firingAlarm.snoozeDuration ?? 5) * 60 * 1000,
      }),
    )
    localStorage.removeItem(FIRING_KEY)
    setFiringAlarm(null)
    window.location.replace('/')
  }, [firingAlarm, updateAlarm])

  const dismiss = useCallback(() => {
    if (!firingAlarm) return
    if (firingAlarm.repeat === 'none') {
      updateAlarm(firingAlarm.id, { enabled: false, snoozeCount: 0 })
    } else {
      updateAlarm(firingAlarm.id, { snoozeCount: 0 })
    }
    localStorage.removeItem(FIRING_KEY)
    localStorage.removeItem(SNOOZE_KEY)
    setFiringAlarm(null)
    window.location.replace('/')
  }, [firingAlarm, updateAlarm])

  // Memoize the context value to prevent unnecessary re-renders of consumers
  const value = useMemo<AlarmContextValue>(
    () => ({
      alarms,
      addAlarm,
      updateAlarm,
      deleteAlarm,
      firingAlarm,
      snooze,
      dismiss,
    }),
    [alarms, addAlarm, updateAlarm, deleteAlarm, firingAlarm, snooze, dismiss],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAlarms(): AlarmContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAlarms must be inside AlarmProvider')
  return ctx
}
