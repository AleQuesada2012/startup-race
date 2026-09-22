import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { EntrepreneurshipType, RoomApi, RoomState } from './roomApi'
import { useRoomAudio } from './useRoomAudio'

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (detail.includes('player_name_taken'))
    return 'Ese nombre ya está en uso en esta sala.'
  if (detail.includes('room_not_found'))
    return 'No encontramos una sala con ese código.'
  if (detail.includes('not_room_member'))
    return 'Ingresa tus datos para unirte a esta sala.'
  if (detail.includes('room_full')) return 'La sala ya tiene cuatro jugadores.'
  if (detail.includes('room_expired')) return 'Esta sala ya expiró.'
  if (detail.includes('room_not_joinable'))
    return 'La partida ya comenzó; no puedes unirte.'
  if (detail.includes('already_joined'))
    return 'Ya tienes un asiento en esta sala.'
  if (detail.includes('not_room_host'))
    return 'Solo quien creó la sala puede iniciar la partida.'
  if (detail.includes('not_enough_players'))
    return 'Se necesitan al menos dos jugadores para iniciar.'
  if (detail.includes('stale_version'))
    return 'La sala cambió. Actualiza e inténtalo de nuevo.'
  if (detail.includes('room_not_startable'))
    return 'Esta sala ya no se puede iniciar.'
  if (detail.includes('not_your_turn'))
    return 'Espera tu Turno para realizar esta acción.'
  if (detail.includes('insufficient_resources'))
    return 'No tienes recursos suficientes para esta Opción.'
  if (detail.includes('deadline_expired'))
    return 'El tiempo de este Turno terminó.'
  if (detail.includes('deadline_not_reached'))
    return 'El tiempo de este Turno aún no termina.'
  if (detail.includes('invalid_turn_phase'))
    return 'La fase del Turno cambió. Actualiza la Sala.'
  if (detail.includes('invalid_player_name'))
    return 'Escribe un nombre de 1 a 24 caracteres.'
  if (detail.includes('configuration_unavailable'))
    return 'La conexión del juego no está configurada.'
  return 'No pudimos completar la acción. Inténtalo de nuevo.'
}

function roomCodeFromUrl(): string {
  return (
    new URLSearchParams(window.location.search)
      .get('room')
      ?.trim()
      .toUpperCase() ?? ''
  )
}

function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /fetch|network|timeout|connection/i.test(error.message)
  )
}

export function useRoomLobby(api: RoomApi) {
  const [mode, setMode] = useState<'home' | 'create' | 'join'>(() =>
    roomCodeFromUrl() ? 'join' : 'home',
  )
  const [code, setCode] = useState(roomCodeFromUrl)
  const [name, setName] = useState('')
  const [type, setType] = useState<EntrepreneurshipType>('technology')
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'reconnecting' | 'restored'
  >('connected')
  const { soundEnabled, toggleSound, prepareForCommand, playStateCue } =
    useRoomAudio()
  const currentVersion = useRef(-1)
  const readTail = useRef<Promise<void>>(Promise.resolve())
  const pendingRequests = useRef(new Map<string, string>())

  function requestIdFor(key: string): string {
    const existing = pendingRequests.current.get(key)
    if (existing) return existing
    const id = crypto.randomUUID()
    pendingRequests.current.set(key, id)
    return id
  }

  function clearRequest(key: string) {
    pendingRequests.current.delete(key)
  }

  function markConnected() {
    setConnectionStatus((previous) =>
      previous === 'reconnecting' ? 'restored' : previous,
    )
  }

  const readRoom = useCallback(
    (roomCode: string): Promise<RoomState> => {
      const pending = readTail.current.then(() => api.getRoomState(roomCode))
      readTail.current = pending.then(
        () => undefined,
        () => undefined,
      )
      return pending
    },
    [api],
  )

  async function refreshAfterCommand(next: RoomState) {
    try {
      const latest = await readRoom(next.room.code)
      showRoom(latest)
      markConnected()
    } catch (cause) {
      if (isNetworkFailure(cause)) setConnectionStatus('reconnecting')
    }
  }

  useEffect(() => {
    if (connectionStatus !== 'restored') return
    const timer = window.setTimeout(
      () => setConnectionStatus('connected'),
      4000,
    )
    return () => window.clearTimeout(timer)
  }, [connectionStatus])

  const showRoom = useCallback(
    (next: RoomState) => {
      if (next.room.version <= currentVersion.current) return
      const hadPreviousState = currentVersion.current >= 0
      currentVersion.current = next.room.version
      setRoomState(next)
      setCode(next.room.code)
      window.history.replaceState(
        {},
        '',
        `/?room=${encodeURIComponent(next.room.code)}`,
      )
      playStateCue(next, hadPreviousState)
    },
    [playStateCue],
  )

  useEffect(() => {
    const initialCode = roomCodeFromUrl()
    if (!initialCode) return
    let cancelled = false
    let done = false
    let inFlight = false
    let retryDelay = 2000
    let timer: ReturnType<typeof setTimeout> | undefined

    async function restore() {
      if (
        cancelled ||
        done ||
        inFlight ||
        document.visibilityState === 'hidden'
      )
        return
      clearTimeout(timer)
      inFlight = true
      try {
        await api.ensureIdentity()
        const restored = await readRoom(initialCode)
        if (!cancelled) {
          done = true
          showRoom(restored)
          markConnected()
          setError('')
        }
      } catch (cause) {
        if (cancelled) return
        if (isNetworkFailure(cause)) {
          setConnectionStatus('reconnecting')
          setError('')
          retryDelay = Math.min(retryDelay * 2, 30000)
          timer = setTimeout(() => void restore(), retryDelay)
        } else if (
          cause instanceof Error &&
          cause.message.includes('not_room_member')
        ) {
          done = true
          setMode('join')
          setError('')
        } else {
          done = true
          setError(errorMessage(cause))
        }
      } finally {
        inFlight = false
      }
    }

    function onFocus() {
      void restore()
    }
    void restore()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [api, readRoom, showRoom])

  useEffect(() => {
    if (!roomState) return
    let cancelled = false
    let inFlight = false
    let retryDelay = 2000
    let lastTimeoutAttempt = -1
    let timer: ReturnType<typeof setTimeout> | undefined
    const roomCode = roomState.room.code

    async function refresh() {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return
      clearTimeout(timer)
      inFlight = true
      try {
        const latest = await readRoom(roomCode)
        if (!cancelled) {
          showRoom(latest)
          markConnected()
          if (
            latest.room.status === 'playing' &&
            latest.room.deadline &&
            Date.parse(latest.room.deadline) <= Date.now() &&
            latest.room.version !== lastTimeoutAttempt
          ) {
            lastTimeoutAttempt = latest.room.version
            const requestKey = `${latest.room.id}:${latest.room.version}:resolve_timeout`
            try {
              const resolved = await api.resolveTimeout(
                latest.room.id,
                latest.room.version,
                requestIdFor(requestKey),
              )
              clearRequest(requestKey)
              if (!cancelled) {
                showRoom(resolved)
                void refreshAfterCommand(resolved)
              }
            } catch (cause) {
              if (!(
                cause instanceof Error &&
                cause.message.includes('stale_version')
              )) {
                lastTimeoutAttempt = -1
              }
            }
          }
          retryDelay = 2000
        }
      } catch {
        retryDelay = Math.min(retryDelay * 2, 30000)
        if (!cancelled) setConnectionStatus('reconnecting')
      } finally {
        inFlight = false
        if (!cancelled) timer = setTimeout(refresh, retryDelay)
      }
    }

    function onFocus() {
      void refresh()
    }
    timer = setTimeout(refresh, retryDelay)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
    // Restart when the Sala changes status or code, not on each version update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, readRoom, roomState?.room.code, roomState?.room.status])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    const normalizedName = name.trim()
    const normalizedCode = code.trim().toUpperCase()
    if (normalizedName.length < 1 || normalizedName.length > 24) {
      setError('Escribe un nombre de 1 a 24 caracteres.')
      return
    }
    if (mode === 'join' && !/^[A-HJ-NP-Z2-9]{6}$/.test(normalizedCode)) {
      setError('Escribe un código de sala de seis caracteres.')
      return
    }
    setBusy(true)
    const requestKey = `${mode}:${normalizedCode}:${normalizedName}:${type}`
    try {
      await api.ensureIdentity()
      const requestId = requestIdFor(requestKey)
      const next =
        mode === 'create'
          ? await api.createRoom(normalizedName, type, requestId)
          : await api.joinRoom(normalizedCode, normalizedName, type, requestId)
      showRoom(next)
      void refreshAfterCommand(next)
      setError('')
      clearRequest(requestKey)
      markConnected()
    } catch (cause) {
      setError(errorMessage(cause))
      if (isNetworkFailure(cause)) setConnectionStatus('reconnecting')
    } finally {
      setBusy(false)
    }
  }

  async function runRoomCommand(
    commandKey: string,
    command: (state: RoomState, requestId: string) => Promise<RoomState>,
  ) {
    if (!roomState || busy) return
    prepareForCommand()
    setBusy(true)
    setError('')
    try {
      const requestKey = `${roomState.room.id}:${roomState.room.version}:${commandKey}`
      const next = await command(roomState, requestIdFor(requestKey))
      showRoom(next)
      void refreshAfterCommand(next)
      clearRequest(requestKey)
      markConnected()
    } catch (cause) {
      setError(errorMessage(cause))
      if (isNetworkFailure(cause)) setConnectionStatus('reconnecting')
    } finally {
      setBusy(false)
    }
  }

  function startGame() {
    return runRoomCommand('start_game', (state, requestId) =>
      api.startGame(state.room.id, state.room.version, requestId),
    )
  }

  function rollDice() {
    return runRoomCommand('roll_dice', (state, requestId) =>
      api.rollDice(state.room.id, state.room.version, requestId),
    )
  }

  function chooseOption(optionId: string) {
    return runRoomCommand(`choose_option:${optionId}`, (state, requestId) =>
      api.chooseOption(state.room.id, optionId, state.room.version, requestId),
    )
  }

  function resolveTimeout() {
    return runRoomCommand('resolve_timeout', (state, requestId) =>
      api.resolveTimeout(state.room.id, state.room.version, requestId),
    )
  }

  const selfIsHost =
    roomState?.players.some((player) => player.is_self && player.is_host) ??
    false

  return {
    mode,
    setMode,
    code,
    setCode,
    name,
    setName,
    type,
    setType,
    roomState,
    busy,
    error,
    connectionStatus,
    soundEnabled,
    toggleSound,
    setError,
    submit,
    startGame,
    rollDice,
    chooseOption,
    resolveTimeout,
    selfIsHost,
  }
}
