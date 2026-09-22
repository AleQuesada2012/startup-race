import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { RoomApi, RoomState } from './lib/roomApi'

const playingRoom: RoomState = {
  room: {
    id: 'room-1',
    code: 'ABC234',
    host_id: 'identity-1',
    status: 'playing',
    phase: 'waiting_for_roll',
    current_player_id: 'player-1',
    round: 2,
    version: 3,
    pending_kind: null,
    pending_card_id: null,
    deadline: '2099-01-01T12:00:00Z',
    result: null,
    expires_at: '2099-01-02T12:00:00Z',
  },
  players: [
    {
      id: 'player-1',
      name: 'Ana',
      entrepreneurship_type: 'technology',
      turn_order: 0,
      position: 5,
      capital: 5000,
      reputation: 1,
      innovation: 2,
      is_host: true,
      is_self: true,
    },
    {
      id: 'player-2',
      name: 'Luis',
      entrepreneurship_type: 'social',
      turn_order: 1,
      position: 8,
      capital: 6000,
      reputation: 2,
      innovation: 1,
      is_host: false,
      is_self: false,
    },
  ],
}

function gameApi(state: RoomState = playingRoom): RoomApi {
  return {
    ensureIdentity: vi.fn().mockResolvedValue(undefined),
    createRoom: vi.fn().mockResolvedValue(state),
    joinRoom: vi.fn().mockResolvedValue(state),
    getRoomState: vi.fn().mockResolvedValue(state),
    startGame: vi.fn().mockResolvedValue(state),
    rollDice: vi.fn().mockResolvedValue(state),
    chooseOption: vi.fn().mockResolvedValue(state),
    resolveTimeout: vi.fn().mockResolvedValue(state),
  }
}

describe('Partida de Startup Race', () => {
  beforeEach(() => window.history.replaceState({}, '', '/?room=ABC234'))
  afterEach(cleanup)

  it('muestra el tablero, los recursos y el Turno actual', async () => {
    render(<App api={gameApi()} />)
    expect(
      await screen.findByRole('heading', { name: 'Partida iniciada' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Tablero de Startup Race' }).children,
    ).toHaveLength(31)
    expect(screen.getByText('Turno de Ana')).toBeInTheDocument()
    expect(screen.getByText('Ronda 2 de 12')).toBeInTheDocument()
    expect(screen.getByText('5000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lanzar dado' })).toBeEnabled()
  })

  it('permite lanzar el dado desde el teclado', async () => {
    const user = userEvent.setup()
    const api = gameApi()
    render(<App api={api} />)
    const roll = await screen.findByRole('button', { name: 'Lanzar dado' })
    await user.tab()
    await user.tab()
    expect(roll).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(api.rollDice).toHaveBeenCalledWith('room-1', 3, expect.any(String))
  })

  it('lanza el dado mediante la Sala y muestra la Tarjeta recibida', async () => {
    const user = userEvent.setup()
    const choiceRoom: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        phase: 'waiting_for_choice',
        pending_kind: 'card',
        pending_card_id: 'decision-partner',
        version: 4,
        result: {
          kind: 'roll',
          roll: 4,
          from_position: 5,
          to_position: 9,
          player_id: 'player-1',
        },
      },
      players: playingRoom.players.map((player) =>
        player.id === 'player-1' ? { ...player, position: 9 } : player,
      ),
    }
    const api = gameApi()
    api.rollDice = vi.fn().mockResolvedValue(choiceRoom)
    render(<App api={api} />)
    await user.click(await screen.findByRole('button', { name: 'Lanzar dado' }))
    expect(api.rollDice).toHaveBeenCalledWith('room-1', 3, expect.any(String))
    expect(
      await screen.findByRole('heading', { name: 'Socio estratégico' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Dado: 4')).toBeInTheDocument()
  })

  it('explica costos y probabilidades de la Tarjeta y envía la Opción elegida', async () => {
    const user = userEvent.setup()
    const choiceRoom: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        phase: 'waiting_for_choice',
        pending_kind: 'card',
        pending_card_id: 'decision-partner',
        version: 4,
      },
    }
    const nextRoom: RoomState = {
      ...choiceRoom,
      room: {
        ...choiceRoom.room,
        phase: 'waiting_for_roll',
        pending_kind: null,
        pending_card_id: null,
        current_player_id: 'player-2',
        version: 5,
        result: {
          kind: 'card',
          outcome_label: 'Piloto aceptado',
          explanation:
            'Un alcance limitado crea confianza sin cerrar otros canales.',
          capital_delta: 500,
          reputation_delta: 1,
          innovation_delta: 0,
        },
      },
    }
    const api = gameApi(choiceRoom)
    api.chooseOption = vi.fn().mockResolvedValue(nextRoom)
    render(<App api={api} />)
    expect(await screen.findByText(/Piloto aceptado: 60%/)).toBeInTheDocument()
    expect(screen.getByText('Costo: 500 Capital')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'Proponer un piloto sin exclusividad',
      }),
    )
    expect(api.chooseOption).toHaveBeenCalledWith(
      'room-1',
      'decision-partner-pilot',
      4,
      expect.any(String),
    )
    expect(await screen.findByText('Piloto aceptado')).toBeInTheDocument()
  })

  it('muestra las decisiones de Empresa y desactiva las que no puede pagar', async () => {
    const user = userEvent.setup()
    const managementRoom: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        phase: 'waiting_for_choice',
        pending_kind: 'management',
      },
      players: playingRoom.players.map((player) =>
        player.id === 'player-1'
          ? { ...player, position: 30, capital: 500 }
          : player,
      ),
    }
    const nextRoom: RoomState = {
      ...managementRoom,
      room: {
        ...managementRoom.room,
        version: 4,
        result: {
          kind: 'management',
          action_id: 'financing',
          capital_delta: 2000,
          reputation_delta: 0,
          innovation_delta: 0,
          explanation: 'El financiamiento aporta capital.',
        },
      },
    }
    const api = gameApi(managementRoom)
    api.chooseOption = vi.fn().mockResolvedValue(nextRoom)
    render(<App api={api} />)
    expect(
      await screen.findByRole('heading', { name: 'Decisiones de Empresa' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Mejorar el producto' }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Buscar financiamiento' }),
    )
    expect(api.chooseOption).toHaveBeenCalledWith(
      'room-1',
      'financing',
      3,
      expect.any(String),
    )
  })

  it('marca el plazo vencido y permite a cualquier Jugador resolverlo', async () => {
    const user = userEvent.setup()
    const expiredTurn: RoomState = {
      ...playingRoom,
      room: { ...playingRoom.room, deadline: '2000-01-01T00:00:00Z' },
      players: playingRoom.players.map((player) => ({
        ...player,
        is_self: player.id === 'player-2',
      })),
    }
    const api = gameApi(expiredTurn)
    render(<App api={api} />)
    expect(await screen.findByText('Tiempo agotado')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Resolver tiempo agotado' }),
    )
    expect(api.resolveTimeout).toHaveBeenCalledWith(
      'room-1',
      3,
      expect.any(String),
    )
  })

  it('presenta la Consolidación y la clasificación final sin más controles', async () => {
    const finishedRoom: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        status: 'finished',
        phase: null,
        current_player_id: null,
        deadline: null,
        version: 9,
        result: {
          kind: 'match_finished',
          reason: 'consolidation',
          winner_player_id: 'player-1',
          rankings: [
            {
              player_id: 'player-1',
              name: 'Ana',
              rank: 1,
              score: 3,
              position: 30,
              capital: 10000,
              reputation: 5,
              innovation: 5,
            },
            {
              player_id: 'player-2',
              name: 'Luis',
              rank: 2,
              score: 2,
              position: 20,
              capital: 6000,
              reputation: 4,
              innovation: 3,
            },
          ],
        },
      },
    }
    render(<App api={gameApi(finishedRoom)} />)
    expect(
      await screen.findByRole('heading', { name: 'Ana consolidó su Empresa' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Clasificación final' }),
    ).toHaveTextContent('1.º Ana')
    expect(
      screen.queryByRole('button', { name: 'Lanzar dado' }),
    ).not.toBeInTheDocument()
  })

  it('explica la clasificación sin Consolidación al terminar la ronda 12', async () => {
    const finishedRoom: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        status: 'finished',
        phase: null,
        current_player_id: null,
        deadline: null,
        round: 12,
        version: 99,
        result: {
          kind: 'match_finished',
          reason: 'round_limit',
          winner_player_id: null,
          rankings: [
            {
              player_id: 'player-1',
              name: 'Ana',
              rank: 1,
              score: 2,
              position: 30,
              capital: 8000,
              reputation: 4,
              innovation: 2,
            },
            {
              player_id: 'player-2',
              name: 'Luis',
              rank: 1,
              score: 2,
              position: 30,
              capital: 8000,
              reputation: 4,
              innovation: 2,
            },
          ],
        },
      },
    }
    render(<App api={gameApi(finishedRoom)} />)
    expect(
      await screen.findByRole('heading', { name: 'Clasificación final' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Nadie alcanzó la Consolidación en 12 rondas.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Clasificación final' }),
    ).toHaveTextContent('1.º Ana')
    expect(
      screen.getByRole('list', { name: 'Clasificación final' }),
    ).toHaveTextContent('1.º Luis')
  })
})
