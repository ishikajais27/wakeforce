// ─── In-memory store for user-uploaded custom sounds ──────────────────────
// (Cleared on page reload — no disk writes, satisfies the "memory only" req)
const _customBuffers = new Map<string, ArrayBuffer>()

export function registerCustomSound(name: string, buf: ArrayBuffer): void {
  _customBuffers.set(name, buf)
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

  // Custom uploaded audio
  if (name.startsWith('custom:')) {
    const key = name.slice(7)
    const raw = _customBuffers.get(key)
    if (raw) return _createCustomHandle(raw.slice(0), volume, AudioCtx)
    // Buffer not in memory (e.g. page refreshed) — fall back gracefully
    name = 'alarm-gentle'
  }

  // ── Synthesised presets ────────────────────────────────────────────────
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
      // Ascending C-E-G major triad
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

// ─── Custom (uploaded) sound player ───────────────────────────────────────

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
