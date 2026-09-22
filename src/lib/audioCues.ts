export type AudioCue = 'roll' | 'decision' | 'win'

const notes: Record<AudioCue, number[]> = {
  roll: [392, 523],
  decision: [523, 659],
  win: [523, 659, 784],
}

let context: AudioContext | null = null

export function prepareAudio(): void {
  if (!window.AudioContext) return
  try {
    context ??= new window.AudioContext()
    void context.resume()
  } catch {
    // Audio is optional; the game stays playable without Web Audio.
  }
}

export function playCue(cue: AudioCue): void {
  prepareAudio()
  if (!context) return
  try {
    notes[cue].forEach((frequency, index) => {
      const startAt = context!.currentTime + index * 0.12
      const oscillator = context!.createOscillator()
      const gain = context!.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, startAt)
      gain.gain.setValueAtTime(0.001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.07, startAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.18)
      oscillator.connect(gain)
      gain.connect(context!.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.18)
    })
  } catch {
    // Playback failure must not interrupt a room command or state update.
  }
}
