export interface AlarmSoundHandle {
  /** Resumes the audio context (needs a user gesture in most browsers)
   *  and starts looping the tone. Resolves true only if actually audible. */
  start: () => Promise<boolean>
  stop: () => void
  setVolume: (v: number) => void
  isRunning: () => boolean
}

/**
 * Generates the alarm tone entirely with the Web Audio API — no mp3 files
 * needed, so there's nothing that can 404. Three distinct patterns map to
 * the three sound options from AlarmForm.
 */
export function createAlarmSound(
  name: string,
  volume: number,
): AlarmSoundHandle {
  const AudioCtx: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext
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
        // state check below covers failure
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
