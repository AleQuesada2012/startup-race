import { useEffect, useRef, useState, type FormEvent } from 'react'
import './App.css'
import {
  getDefaultRoomApi,
  type EntrepreneurshipType,
  type RoomApi,
  type RoomState,
} from './lib/roomApi'

const journeyStops = [
  { boardPosition: 0, label: 'Idea' },
  { boardPosition: 1, label: 'Validación' },
  { boardPosition: 8, label: 'Prototipo' },
  { boardPosition: 15, label: 'Lanzamiento' },
  { boardPosition: 22, label: 'Crecimiento' },
] as const

const typeNames: Record<EntrepreneurshipType, string> = {
  technology: 'Tecnología',
  social: 'Social',
  traditional: 'Tradicional',
}

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

function App({ api = getDefaultRoomApi() }: { api?: RoomApi }) {
  const [mode, setMode] = useState<'home' | 'create' | 'join'>(() =>
    roomCodeFromUrl() ? 'join' : 'home',
  )
  const [code, setCode] = useState(roomCodeFromUrl)
  const [name, setName] = useState('')
  const [type, setType] = useState<EntrepreneurshipType>('technology')
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const currentVersion = useRef(-1)

  function showRoom(next: RoomState) {
    if (next.room.version < currentVersion.current) return
    currentVersion.current = next.room.version
    setRoomState(next)
    setCode(next.room.code)
    window.history.replaceState(
      {},
      '',
      `/?room=${encodeURIComponent(next.room.code)}`,
    )
    setError('')
  }

  useEffect(() => {
    const initialCode = roomCodeFromUrl()
    if (!initialCode) return
    let cancelled = false
    void (async () => {
      try {
        await api.ensureIdentity()
        const restored = await api.getRoomState(initialCode)
        if (!cancelled) showRoom(restored)
      } catch (cause) {
        if (cancelled) return
        if (
          cause instanceof Error &&
          cause.message.includes('not_room_member')
        ) {
          setMode('join')
          setError('')
        } else {
          setError(errorMessage(cause))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api])

  useEffect(() => {
    if (!roomState || roomState.room.status !== 'waiting') return
    let cancelled = false
    let inFlight = false
    let retryDelay = 2000
    let timer: ReturnType<typeof setTimeout> | undefined
    const roomCode = roomState.room.code

    async function refresh() {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return
      clearTimeout(timer)
      inFlight = true
      try {
        const latest = await api.getRoomState(roomCode)
        if (!cancelled) {
          showRoom(latest)
          retryDelay = 2000
        }
      } catch {
        retryDelay = Math.min(retryDelay * 2, 30000)
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
  }, [api, roomState?.room.code, roomState?.room.status])

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
    try {
      await api.ensureIdentity()
      const requestId = crypto.randomUUID()
      const next =
        mode === 'create'
          ? await api.createRoom(normalizedName, type, requestId)
          : await api.joinRoom(normalizedCode, normalizedName, type, requestId)
      showRoom(next)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function startGame() {
    if (!roomState || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await api.startGame(
        roomState.room.id,
        roomState.room.version,
        crypto.randomUUID(),
      )
      showRoom(next)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const selfIsHost =
    roomState?.players.some((player) => player.is_self && player.is_host) ??
    false

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Startup Race, inicio">
          <span aria-hidden="true">SR</span>Startup Race
        </a>
        <span className="status-badge">MVP académico</span>
      </header>

      {roomState ? (
        <section className="lobby" aria-labelledby="room-title">
          <p className="eyebrow">
            {roomState.room.status === 'waiting'
              ? 'Sala de espera'
              : 'Startup Race'}
          </p>
          <h1 id="room-title">
            {roomState.room.status === 'waiting'
              ? `Sala ${roomState.room.code}`
              : 'Partida iniciada'}
          </h1>
          <p className="lede">
            {roomState.room.status === 'waiting'
              ? 'Comparte el código para invitar a tus compañeros.'
              : `Ronda ${roomState.room.round}`}
          </p>
          <p className="room-code">
            Código: <strong>{roomState.room.code}</strong>
          </p>
          <h2>Jugadores ({roomState.players.length}/4)</h2>
          <ul className="player-list">
            {roomState.players.map((player) => (
              <li key={player.id}>
                <strong>{player.name}</strong>
                <span>{typeNames[player.entrepreneurship_type]}</span>
                {player.is_host && <span>Anfitrión</span>}
                {player.is_self && <span>Tú</span>}
              </li>
            ))}
          </ul>
          {roomState.room.status === 'waiting' &&
            (selfIsHost ? (
              <button
                className="button primary"
                type="button"
                disabled={busy || roomState.players.length < 2}
                onClick={startGame}
              >
                Iniciar partida
              </button>
            ) : (
              <p>Esperando a que el anfitrión inicie la partida.</p>
            ))}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">El juego de crear, decidir y crecer</p>
            <h1 id="hero-title">Startup Race</h1>
            <p className="lede">
              Convierte una idea en empresa. Toma decisiones, enfrenta crisis y
              reúne los recursos para consolidar tu emprendimiento antes que los
              demás.
            </p>
            {mode === 'home' ? (
              <div className="actions" aria-label="Opciones para jugar">
                <button
                  className="button primary"
                  type="button"
                  onClick={() => {
                    setMode('create')
                    setError('')
                  }}
                >
                  Crear una sala
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setMode('join')
                    setError('')
                  }}
                >
                  Unirme con un código
                </button>
              </div>
            ) : (
              <form className="room-form" onSubmit={submit}>
                <h2>
                  {mode === 'create' ? 'Crear una sala' : 'Unirme a una sala'}
                </h2>
                {mode === 'join' && (
                  <label>
                    Código de sala
                    <input
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.toUpperCase())
                      }
                      maxLength={6}
                      required
                      autoComplete="off"
                    />
                  </label>
                )}
                <label>
                  Tu nombre
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={24}
                    required
                    autoComplete="name"
                  />
                </label>
                <label>
                  Tipo de emprendimiento
                  <select
                    value={type}
                    onChange={(event) =>
                      setType(event.target.value as EntrepreneurshipType)
                    }
                  >
                    <option value="technology">Tecnología</option>
                    <option value="social">Social</option>
                    <option value="traditional">Tradicional</option>
                  </select>
                </label>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
                <button
                  className="button primary"
                  type="submit"
                  disabled={busy}
                >
                  {busy
                    ? 'Conectando…'
                    : mode === 'create'
                      ? 'Crear sala'
                      : 'Unirme a la sala'}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setMode('home')
                    setError('')
                  }}
                >
                  Volver
                </button>
              </form>
            )}
            {mode === 'home' && (
              <p className="player-note">Para 2–4 jugadores · Sin cuentas</p>
            )}
            {mode === 'home' && error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </div>
          <div className="game-card" aria-label="Ruta de una partida">
            <div className="game-card-top">
              <span>Tu ruta emprendedora</span>
              <span aria-hidden="true">↗</span>
            </div>
            <ol className="stage-list">
              {journeyStops.map(({ boardPosition, label }) => (
                <li key={label}>
                  <span className="stage-number">{boardPosition}</span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
            <div className="resource-row" aria-label="Recursos para consolidar">
              <span>Capital</span>
              <span>Reputación</span>
              <span>Innovación</span>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

export default App
