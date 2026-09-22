import { useEffect, useState } from 'react'
import { gameContent } from './domain/gameContent'
import type { ResourceVector } from './domain/contentTypes'
import type { RoomState } from './lib/roomApi'

const stageLabels = {
  idea: 'Idea',
  validation: 'Validación',
  prototype: 'Prototipo',
  launch: 'Lanzamiento',
  growth: 'Crecimiento',
  company: 'Empresa',
} as const

const categoryLabels = {
  decision: 'Decisión',
  innovation: 'Innovación',
  opportunity: 'Oportunidad',
  crisis: 'Crisis',
} as const

interface Props {
  state: RoomState
  busy: boolean
  error: string
  onRoll(): void
  onChoose(optionId: string): void
  onTimeout(): void
}

interface Ranking {
  player_id: string
  name: string
  rank: number
  score: number
  position: number
  capital: number
  reputation: number
  innovation: number
}

function resourceSummary(values: ResourceVector): string {
  const parts = [
    values.capital && `${values.capital} Capital`,
    values.reputation && `${values.reputation} Reputación`,
    values.innovation && `${values.innovation} Innovación`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'ninguno'
}

function canAfford(
  cost: ResourceVector,
  player: RoomState['players'][number] | undefined,
): boolean {
  return (
    !!player &&
    player.capital >= cost.capital &&
    player.reputation >= cost.reputation &&
    player.innovation >= cost.innovation
  )
}

function GameBoard({ state, busy, error, onRoll, onChoose, onTimeout }: Props) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (state.room.status !== 'playing' || !state.room.deadline) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [state.room.status, state.room.deadline])
  const remainingSeconds = state.room.deadline
    ? Math.max(0, Math.ceil((Date.parse(state.room.deadline) - now) / 1000))
    : null
  const timeExpired = remainingSeconds === 0
  const currentPlayer = state.players.find(
    (player) => player.id === state.room.current_player_id,
  )
  const isMyTurn = currentPlayer?.is_self ?? false
  const result = state.room.result as Record<string, unknown> | null
  const pendingCard = gameContent.cards.find(
    (card) => card.id === state.room.pending_card_id,
  )
  const finished = result?.kind === 'match_finished' ? result : null
  const rankings = Array.isArray(finished?.rankings)
    ? (finished.rankings as Ranking[])
    : []
  const winner = state.players.find(
    (player) => player.id === finished?.winner_player_id,
  )
  const finalTitle =
    finished?.reason === 'consolidation' && winner
      ? `${winner.name} consolidó su Empresa`
      : 'Clasificación final'

  return (
    <section className="match" aria-labelledby="match-title">
      <header className="match-header">
        <div>
          <p className="eyebrow">Sala {state.room.code}</p>
          <h1 id="match-title">
            {state.room.status === 'finished'
              ? finalTitle
              : state.room.status === 'expired'
                ? 'Sala expirada'
                : 'Partida iniciada'}
          </h1>
        </div>
        <div className="turn-summary">
          <strong>Ronda {state.room.round} de 12</strong>
          <span>
            {currentPlayer
              ? `Turno de ${currentPlayer.name}`
              : 'Partida finalizada'}
          </span>
          {state.room.status === 'playing' && state.room.deadline && (
            <div className="deadline">
              <span>
                {timeExpired
                  ? 'Tiempo agotado'
                  : `Tiempo restante: ${Math.floor((remainingSeconds ?? 0) / 60)}:${String((remainingSeconds ?? 0) % 60).padStart(2, '0')}`}
              </span>
              <time dateTime={state.room.deadline}>
                Límite:{' '}
                {new Date(state.room.deadline).toLocaleTimeString('es', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          )}
        </div>
      </header>
      <div className="match-layout">
        <div className="board-panel">
          <h2>Tablero</h2>
          <ol
            className="board-grid"
            aria-label="Tablero de Startup Race"
            start={0}
          >
            {gameContent.board.map((space) => {
              const occupants = state.players.filter(
                (player) => player.position === space.position,
              )
              return (
                <li
                  key={space.position}
                  className={`board-space board-${space.stage}`}
                  aria-label={`Casilla ${space.position}: ${stageLabels[space.stage]}${space.category ? `, ${categoryLabels[space.category]}` : ''}${occupants.length ? `; ${occupants.map((player) => player.name).join(', ')}` : ''}`}
                >
                  <span className="board-number">{space.position}</span>
                  <span className="board-stage">
                    {stageLabels[space.stage]}
                  </span>
                  {space.category && (
                    <span className="board-category">
                      {categoryLabels[space.category]}
                    </span>
                  )}
                  {occupants.length > 0 && (
                    <span className="board-occupants">
                      {occupants.map((player) => player.name).join(' · ')}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
        <aside className="match-side">
          {state.room.status === 'finished' && finished && (
            <section className="result-panel" aria-labelledby="results-title">
              <h2 id="results-title">Posiciones</h2>
              {finished.reason === 'round_limit' ? (
                <p>Nadie alcanzó la Consolidación en 12 rondas.</p>
              ) : (
                <p>La Consolidación terminó la Partida.</p>
              )}
              <ol className="ranking-list" aria-label="Clasificación final">
                {rankings.map((entry) => (
                  <li key={entry.player_id}>
                    <strong>
                      {entry.rank}.º {entry.name}
                    </strong>
                    <span>
                      Puntaje: {Number(entry.score).toFixed(2)} · Casilla{' '}
                      {entry.position}
                    </span>
                    <span>
                      Capital {entry.capital} · Reputación {entry.reputation} ·
                      Innovación {entry.innovation}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section className="resource-panel" aria-labelledby="resources-title">
            <h2 id="resources-title">Jugadores y recursos</h2>
            <ul className="resource-list">
              {state.players.map((player) => (
                <li key={player.id}>
                  <strong>
                    {player.name}
                    {player.is_self ? ' (tú)' : ''}
                  </strong>
                  <span>Casilla {player.position}</span>
                  <dl>
                    <div>
                      <dt>Capital</dt>
                      <dd>{player.capital}</dd>
                    </div>
                    <div>
                      <dt>Reputación</dt>
                      <dd>{player.reputation}</dd>
                    </div>
                    <div>
                      <dt>Innovación</dt>
                      <dd>{player.innovation}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
          {state.room.status === 'playing' &&
            state.room.phase === 'waiting_for_roll' && (
              <section className="action-panel" aria-labelledby="action-title">
                <h2 id="action-title">Lanzamiento</h2>
                <p>
                  {isMyTurn
                    ? 'Lanza el dado para avanzar.'
                    : `Esperando el lanzamiento de ${currentPlayer?.name ?? 'otro jugador'}.`}
                </p>
                {isMyTurn && (
                  <button
                    className="button primary"
                    type="button"
                    disabled={busy}
                    onClick={onRoll}
                  >
                    Lanzar dado
                  </button>
                )}
              </section>
            )}
          {typeof result?.roll === 'number' && (
            <p className="roll-result">Dado: {result.roll}</p>
          )}
          {result?.kind === 'card' &&
            typeof result.outcome_label === 'string' && (
              <section
                className="result-panel"
                aria-label="Resultado de la Tarjeta"
              >
                <h2>{result.outcome_label}</h2>
                {typeof result.explanation === 'string' && (
                  <p>{result.explanation}</p>
                )}
                {result.timed_out === true && (
                  <p>El plazo terminó y se aplicó la Opción gratuita.</p>
                )}
              </section>
            )}
          {result?.kind === 'roll_timeout' && (
            <section className="result-panel" aria-label="Resultado del plazo">
              <h2>Tiempo agotado</h2>
              <p>El Turno terminó sin lanzar el dado.</p>
            </section>
          )}
          {result?.kind === 'management_timeout' && (
            <section className="result-panel" aria-label="Resultado del plazo">
              <h2>Tiempo agotado</h2>
              <p>Se omitió la decisión de Empresa sin cambiar recursos.</p>
            </section>
          )}
          {result?.kind === 'management' &&
            typeof result.explanation === 'string' && (
              <section
                className="result-panel"
                aria-label="Resultado de Empresa"
              >
                <h2>Decisión aplicada</h2>
                <p>{result.explanation}</p>
              </section>
            )}
          {state.room.status === 'playing' &&
            state.room.phase === 'waiting_for_choice' &&
            state.room.pending_kind === 'card' &&
            pendingCard && (
              <section className="action-panel" aria-labelledby="card-title">
                <p className="eyebrow">
                  Tarjeta de {categoryLabels[pendingCard.category]}
                </p>
                <h2 id="card-title">{pendingCard.title}</h2>
                <p>{pendingCard.scenario}</p>
                <ul className="option-list">
                  {pendingCard.options.map((option) => (
                    <li key={option.id}>
                      <h3>{option.label}</h3>
                      <p>
                        Costo:{' '}
                        {option.cost.capital ||
                        option.cost.reputation ||
                        option.cost.innovation
                          ? resourceSummary(option.cost)
                          : 'gratis'}
                      </p>
                      <ul>
                        {option.outcomes.map((outcome) => (
                          <li key={outcome.id}>
                            {outcome.label}: {outcome.probability}% ·{' '}
                            {resourceSummary(outcome.effect)}
                          </li>
                        ))}
                      </ul>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={
                          !isMyTurn ||
                          busy ||
                          !canAfford(option.cost, currentPlayer)
                        }
                        onClick={() => onChoose(option.id)}
                      >
                        {option.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          {state.room.status === 'playing' &&
            state.room.phase === 'waiting_for_choice' &&
            state.room.pending_kind === 'management' && (
              <section
                className="action-panel"
                aria-labelledby="management-title"
              >
                <p className="eyebrow">Casilla 30</p>
                <h2 id="management-title">Decisiones de Empresa</h2>
                <p>
                  Reúne 10 000 de Capital, 5 de Reputación y 5 de Innovación
                  para consolidar.
                </p>
                <ul className="option-list">
                  {gameContent.managementActions.map((action) => (
                    <li key={action.id}>
                      <h3>{action.label}</h3>
                      <p>Costo: {resourceSummary(action.cost)}</p>
                      <p>Recibes: {resourceSummary(action.effect)}</p>
                      <p>{action.explanation}</p>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={
                          !isMyTurn ||
                          busy ||
                          !canAfford(action.cost, currentPlayer)
                        }
                        onClick={() => onChoose(action.id)}
                      >
                        {action.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          {state.room.status === 'playing' && timeExpired && (
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={onTimeout}
            >
              Resolver tiempo agotado
            </button>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}

export default GameBoard
