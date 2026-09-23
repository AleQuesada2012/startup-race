import './App.css'
import { lazy, Suspense } from 'react'
import GameBoard from './GameBoard'
import {
  getDefaultRoomApi,
  type EntrepreneurshipType,
  type RoomApi,
} from './lib/roomApi'
import { useRoomLobby } from './lib/useRoomLobby'
import { useTurnstileChallenge } from './lib/useTurnstileChallenge'

const Turnstile = lazy(async () => {
  const { Turnstile: component } = await import('@marsidev/react-turnstile')
  return { default: component }
})

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

function App({
  api = getDefaultRoomApi(),
  turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY,
}: {
  api?: RoomApi
  turnstileSiteKey?: string
}) {
  const challenge = useTurnstileChallenge(turnstileSiteKey)
  const {
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
  } = useRoomLobby(api, challenge.requestToken)
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Startup Race, inicio">
          <span aria-hidden="true">SR</span>Startup Race
        </a>
        <div className="header-actions">
          <button
            className="sound-toggle"
            type="button"
            aria-pressed={soundEnabled}
            onClick={toggleSound}
          >
            {soundEnabled ? 'Silenciar sonidos' : 'Activar sonidos'}
          </button>
          <span className="status-badge">MVP académico</span>
        </div>
      </header>
      {connectionStatus !== 'connected' && (
        <p className="connection-status" role="status">
          {connectionStatus === 'reconnecting'
            ? 'Reconectando con la Sala…'
            : 'Conexión restablecida'}
        </p>
      )}
      {challenge.active && turnstileSiteKey && (
        <div
          className="turnstile-challenge"
          role="group"
          aria-label="Verificación de seguridad"
        >
          <p>Completa la verificación para entrar a la Sala.</p>
          <Suspense fallback={<p>Cargando verificación…</p>}>
            <Turnstile
              siteKey={turnstileSiteKey}
              options={{ action: 'anonymous_signin', language: 'es' }}
              onSuccess={challenge.onSuccess}
              onError={challenge.onFailure}
              onTimeout={challenge.onFailure}
              onUnsupported={challenge.onFailure}
            />
          </Suspense>
        </div>
      )}

      {roomState && roomState.room.status !== 'waiting' ? (
        <GameBoard
          state={roomState}
          busy={busy}
          error={error}
          onRoll={rollDice}
          onChoose={chooseOption}
          onTimeout={resolveTimeout}
        />
      ) : roomState ? (
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
              <form className="room-form" onSubmit={submit} noValidate>
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
