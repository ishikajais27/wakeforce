// ─── IndexedDB persistence for custom sounds ───────────────────────────────
const DB_NAME = 'wakeforce_db'
const STORE_NAME = 'custom_sounds'
const DB_VERSION = 1

function openSoundDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveCustomSoundToDB(
  name: string,
  buf: ArrayBuffer,
): Promise<void> {
  try {
    const db = await openSoundDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(buf, name)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IndexedDB not available or full — silently skip
  }
}

export async function loadCustomSoundFromDB(
  name: string,
): Promise<ArrayBuffer | null> {
  try {
    const db = await openSoundDB()
    return await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(name)
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

// ─── In-memory store for current session ──────────────────────────────────
const _customBuffers = new Map<string, ArrayBuffer>()

export function registerCustomSound(name: string, buf: ArrayBuffer): void {
  _customBuffers.set(name, buf)
  // Persist to IndexedDB so it survives page reloads
  saveCustomSoundToDB(name, buf).catch(() => {})
}

export function hasCustomSound(name: string): boolean {
  return _customBuffers.has(name)
}

// ─── Public interface ──────────────────────────────────────────────────────
export interface AlarmSoundHandle {
  /** Resume AudioContext (requires prior user gesture) and start looping.
   *  Returns true only when audio is actually audible. */
  start: () => Promise<boolean>
  stop: () => void
  setVolume: (v: number) => void
  isRunning: () => boolean
}

export function createAlarmSound(
  name: string,
  volume: number,
): AlarmSoundHandle {
  const AudioCtx: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext

  // ── Custom uploaded audio ──────────────────────────────────────────────
  if (name.startsWith('custom:')) {
    const key = name.slice(7)
    const raw = _customBuffers.get(key)
    if (raw) {
      // Already in memory — play directly
      return _createCustomHandle(raw.slice(0), volume, AudioCtx)
    }
    // Not in memory — will attempt to load from IndexedDB on start()
    return _createAsyncCustomHandle(key, volume, AudioCtx)
  }

  // ── Synthesised presets ────────────────────────────────────────────────
  return _createSynthHandle(name, volume, AudioCtx)
}

// ─── Synth preset handle ───────────────────────────────────────────────────
function _createSynthHandle(
  name: string,
  volume: number,
  AudioCtx: typeof AudioContext,
): AlarmSoundHandle {
  const ctx = new AudioCtx()
  const masterGain = ctx.createGain()
  masterGain.gain.value = volume
  masterGain.connect(ctx.destination)

  let stopped = false
  let scheduled = false
  const timers: ReturnType<typeof setTimeout>[] = []

  function beep(
    freq: number,
    duration: number,
    when: number,
    type: OscillatorType = 'sine',
  ) {
    if (stopped) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(masterGain)
    const t0 = ctx.currentTime + when
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(1, t0 + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
    osc.start(t0)
    osc.stop(t0 + duration + 0.05)
  }

  function cycle() {
    if (stopped) return
    let cycleMs: number

    if (name === 'alarm-digital') {
      beep(1100, 0.1, 0)
      beep(1100, 0.1, 0.18)
      beep(1100, 0.1, 0.36)
      cycleMs = 1200
    } else if (name === 'alarm-loud') {
      beep(420, 0.16, 0, 'square')
      beep(640, 0.16, 0.18, 'square')
      beep(420, 0.16, 0.36, 'square')
      beep(640, 0.16, 0.54, 'square')
      cycleMs = 950
    } else if (name === 'alarm-chime') {
      beep(523, 0.5, 0)
      beep(659, 0.5, 0.38)
      beep(784, 0.65, 0.76)
      cycleMs = 2500
    } else {
      // 'alarm-gentle' / fallback
      beep(660, 0.4, 0)
      beep(880, 0.4, 0.45)
      cycleMs = 1700
    }

    timers.push(setTimeout(cycle, cycleMs))
  }

  return {
    start: async () => {
      if (scheduled) return ctx.state === 'running'
      try {
        await ctx.resume()
      } catch {
        /* handled below */
      }
      if (ctx.state !== 'running') return false
      scheduled = true
      cycle()
      return true
    },
    stop: () => {
      stopped = true
      timers.forEach(clearTimeout)
      timers.length = 0
      masterGain.gain.value = 0
      setTimeout(() => ctx.close().catch(() => {}), 100)
    },
    setVolume: (v: number) => {
      masterGain.gain.value = v
    },
    isRunning: () => ctx.state === 'running',
  }
}

// ─── Async custom handle — loads buffer from IndexedDB on start() ──────────
function _createAsyncCustomHandle(
  key: string,
  volume: number,
  AudioCtx: typeof AudioContext,
): AlarmSoundHandle {
  const ctx = new AudioCtx()
  const masterGain = ctx.createGain()
  masterGain.gain.value = volume
  masterGain.connect(ctx.destination)

  let stopped = false
  let decoded: AudioBuffer | null = null
  let src: AudioBufferSourceNode | null = null
  // Fallback synth handle in case buffer is not found
  let fallback: AlarmSoundHandle | null = null

  const playLoop = () => {
    if (stopped || !decoded) return
    src = ctx.createBufferSource()
    src.buffer = decoded
    src.connect(masterGain)
    src.onended = () => {
      if (!stopped) playLoop()
    }
    src.start()
  }

  return {
    start: async () => {
      try {
        await ctx.resume()
      } catch {}

      if (ctx.state !== 'running' || stopped) return false

      if (!decoded) {
        // 1. Try in-memory cache (set by registerCustomSound this session)
        let raw = _customBuffers.get(key)

        // 2. Try IndexedDB (persisted from a previous session)
        if (!raw) {
          const stored = await loadCustomSoundFromDB(key)
          if (stored) {
            raw = stored
            // Re-populate memory cache
            _customBuffers.set(key, stored)
          }
        }

        // 3. If still not found, fall back to default synth alarm
        if (!raw) {
          // Close our AudioContext and hand off to a fresh synth handle
          masterGain.gain.value = 0
          setTimeout(() => ctx.close().catch(() => {}), 100)
          fallback = _createSynthHandle('alarm-gentle', volume, AudioCtx)
          const result = await fallback.start()
          return result
        }

        try {
          decoded = await ctx.decodeAudioData(raw.slice(0))
        } catch {
          // Corrupt buffer — fall back to synth
          masterGain.gain.value = 0
          setTimeout(() => ctx.close().catch(() => {}), 100)
          fallback = _createSynthHandle('alarm-gentle', volume, AudioCtx)
          const result = await fallback.start()
          return result
        }
      }

      playLoop()
      return true
    },
    stop: () => {
      if (fallback) {
        fallback.stop()
        fallback = null
        return
      }
      stopped = true
      try {
        src?.stop()
      } catch {}
      masterGain.gain.value = 0
      setTimeout(() => ctx.close().catch(() => {}), 100)
    },
    setVolume: (v: number) => {
      if (fallback) {
        fallback.setVolume(v)
        return
      }
      masterGain.gain.value = v
    },
    isRunning: () => {
      if (fallback) return fallback.isRunning()
      return ctx.state === 'running'
    },
  }
}

// ─── Custom (uploaded) sound player — buffer already in memory ────────────
function _createCustomHandle(
  buffer: ArrayBuffer,
  volume: number,
  AudioCtx: typeof AudioContext,
): AlarmSoundHandle {
  const ctx = new AudioCtx()
  const masterGain = ctx.createGain()
  masterGain.gain.value = volume
  masterGain.connect(ctx.destination)

  let stopped = false
  let decoded: AudioBuffer | null = null
  let src: AudioBufferSourceNode | null = null

  const playLoop = () => {
    if (stopped || !decoded) return
    src = ctx.createBufferSource()
    src.buffer = decoded
    src.connect(masterGain)
    src.onended = () => {
      if (!stopped) playLoop()
    }
    src.start()
  }

  return {
    start: async () => {
      try {
        await ctx.resume()
      } catch {}
      if (ctx.state !== 'running' || stopped) return false
      if (!decoded) {
        try {
          decoded = await ctx.decodeAudioData(buffer)
        } catch {
          return false
        }
      }
      playLoop()
      return true
    },
    stop: () => {
      stopped = true
      try {
        src?.stop()
      } catch {}
      masterGain.gain.value = 0
      setTimeout(() => ctx.close().catch(() => {}), 100)
    },
    setVolume: (v) => {
      masterGain.gain.value = v
    },
    isRunning: () => ctx.state === 'running',
  }
}
