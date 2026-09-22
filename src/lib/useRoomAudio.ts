import { useCallback, useRef, useState } from 'react'
import { playCue, prepareAudio } from './audioCues'
import type { RoomState } from './roomApi'

function storedSoundPreference(): boolean {
  try {
    return window.localStorage.getItem('startup-race:sound') === 'on'
  } catch {
    return false
  }
}

export function useRoomAudio() {
  const [soundEnabled, setSoundEnabled] = useState(storedSoundPreference)
  const enabled = useRef(soundEnabled)

  const toggleSound = useCallback(() => {
    const next = !enabled.current
    enabled.current = next
    setSoundEnabled(next)
    try {
      window.localStorage.setItem('startup-race:sound', next ? 'on' : 'off')
    } catch {
      // Keep the preference for the current page even if storage is unavailable.
    }
    if (next) prepareAudio()
  }, [])

  const prepareForCommand = useCallback(() => {
    if (enabled.current) prepareAudio()
  }, [])

  const playStateCue = useCallback(
    (state: RoomState, hadPreviousState: boolean) => {
      if (!hadPreviousState || !enabled.current) return
      const result = state.room.result
      if (!result || typeof result !== 'object') return
      const kind = (result as Record<string, unknown>).kind
      if (kind === 'roll') playCue('roll')
      else if (kind === 'card' || kind === 'management') playCue('decision')
      else if (kind === 'match_finished') playCue('win')
    },
    [],
  )

  return { soundEnabled, toggleSound, prepareForCommand, playStateCue }
}
