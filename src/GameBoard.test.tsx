import { act, cleanup, render, screen } from '@testing-library/react'
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
  beforeEach(() => {
    window.history.replaceState({}, '', '/?room=ABC234')
    window.localStorage.clear()
  })
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
    await user.tab()
    expect(roll).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(api.rollDice).toHaveBeenCalledWith('room-1', 3, expect.any(String))
  })

  it('conserva el ID de solicitud al reintentar un lanzamiento sin respuesta', async () => {
    const user = userEvent.setup()
    const api = gameApi()
    const next: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        version: 4,
        phase: 'waiting_for_choice',
        pending_kind: 'card',
        pending_card_id: 'decision-partner',
      },
    }
    const rollDice = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(next)
    api.rollDice = rollDice
    render(<App api={api} />)
    await user.click(await screen.findByRole('button', { name: 'Lanzar dado' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Reconectando')
    await user.click(screen.getByRole('button', { name: 'Lanzar dado' }))
    expect(
      await screen.findByRole('heading', { name: 'Socio estratégico' }),
    ).toBeInTheDocument()
    expect(rollDice.mock.calls[1][2]).toBe(rollDice.mock.calls[0][2])
  })

  it('reutiliza el ID cuando la resolución automática del tiempo pierde la respuesta', async () => {
    const expired: RoomState = {
      ...playingRoom,
      room: { ...playingRoom.room, deadline: '2020-01-01T00:00:00Z' },
    }
    const api = gameApi(expired)
    const resolveTimeout = vi
      .fn()
      .mockRejectedValue(new Error('Failed to fetch'))
    api.resolveTimeout = resolveTimeout
    render(<App api={api} />)
    await screen.findByRole('heading', { name: 'Partida iniciada' })
    await act(async () => window.dispatchEvent(new Event('focus')))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(resolveTimeout).toHaveBeenCalledTimes(2)
    expect(resolveTimeout.mock.calls[1][2]).toBe(
      resolveTimeout.mock.calls[0][2],
    )
  })

  it('consulta la Sala inmediatamente después de un comando', async () => {
    const user = userEvent.setup()
    const next: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        version: 4,
        result: { kind: 'roll', roll: 4 },
      },
    }
    const api = gameApi()
    api.rollDice = vi.fn().mockResolvedValue(next)
    const getRoomState = vi.fn().mockResolvedValue(playingRoom)
    api.getRoomState = getRoomState
    render(<App api={api} />)
    await user.click(await screen.findByRole('button', { name: 'Lanzar dado' }))
    expect(await screen.findByText('Dado: 4')).toBeInTheDocument()
    expect(getRoomState).toHaveBeenCalledTimes(2)
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

  it('mantiene la acción disponible si solo el reloj del navegador considera vencido el plazo', async () => {
    const clockAhead: RoomState = {
      ...playingRoom,
      room: { ...playingRoom.room, deadline: '2000-01-01T00:00:00Z' },
    }
    render(<App api={gameApi(clockAhead)} />)
    expect(
      await screen.findByRole('button', { name: 'Lanzar dado' }),
    ).toBeEnabled()
  })

  it('resuelve un plazo vencido cuando un miembro sigue consultando la Sala', async () => {
    const expiredTurn: RoomState = {
      ...playingRoom,
      room: { ...playingRoom.room, deadline: '2000-01-01T00:00:00Z' },
    }
    const api = gameApi(expiredTurn)
    render(<App api={api} />)
    await screen.findByRole('heading', { name: 'Partida iniciada' })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(api.resolveTimeout).toHaveBeenCalledWith(
      'room-1',
      3,
      expect.any(String),
    )
  })

  it('explica cuando vence un lanzamiento o una decisión de Empresa', async () => {
    const timedOut: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        result: { kind: 'roll_timeout', timed_out: true },
      },
    }
    const api = gameApi(timedOut)
    render(<App api={api} />)
    expect(
      await screen.findByText('El Turno terminó sin lanzar el dado.'),
    ).toBeInTheDocument()
  })

  it('explica la decisión de Empresa omitida por tiempo', async () => {
    const timedOut: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        result: { kind: 'management_timeout', timed_out: true },
      },
    }
    render(<App api={gameApi(timedOut)} />)
    expect(
      await screen.findByText(
        'Se omitió la decisión de Empresa sin cambiar recursos.',
      ),
    ).toBeInTheDocument()
  })

  it('aclara cuando se aplica la Opción gratuita por tiempo', async () => {
    const timedOut: RoomState = {
      ...playingRoom,
      room: {
        ...playingRoom.room,
        result: {
          kind: 'card',
          timed_out: true,
          outcome_label: 'Piloto aceptado',
          explanation: 'Un alcance limitado crea confianza.',
        },
      },
    }
    render(<App api={gameApi(timedOut)} />)
    expect(
      await screen.findByText(
        'El plazo terminó y se aplicó la Opción gratuita.',
      ),
    ).toBeInTheDocument()
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

  it('reproduce señales de dado, decisión y victoria solo después de activar sonidos', async () => {
    const starts = vi.fn()
    class FakeAudioContext {
      currentTime = 0
      destination = {}
      resume = vi.fn().mockResolvedValue(undefined)
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: starts,
          stop: vi.fn(),
        }
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        }
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    try {
      const user = userEvent.setup()
      const rolled: RoomState = {
        ...playingRoom,
        room: {
          ...playingRoom.room,
          version: 4,
          result: { kind: 'roll', roll: 4 },
        },
      }
      const decided: RoomState = {
        ...rolled,
        room: {
          ...rolled.room,
          version: 5,
          result: { kind: 'card', outcome_label: 'Piloto aceptado' },
        },
      }
      const won: RoomState = {
        ...decided,
        room: {
          ...decided.room,
          version: 6,
          status: 'finished',
          phase: null,
          current_player_id: null,
          deadline: null,
          result: {
            kind: 'match_finished',
            reason: 'consolidation',
            winner_player_id: 'player-1',
            rankings: [],
          },
        },
      }
      const api = gameApi()
      api.rollDice = vi.fn().mockResolvedValue(rolled)
      api.getRoomState = vi
        .fn()
        .mockResolvedValueOnce(playingRoom)
        .mockResolvedValueOnce(rolled)
        .mockResolvedValueOnce(decided)
        .mockResolvedValue(won)
      render(<App api={api} />)
      await user.click(
        await screen.findByRole('button', { name: 'Activar sonidos' }),
      )
      await user.click(screen.getByRole('button', { name: 'Lanzar dado' }))
      expect(starts).toHaveBeenCalledTimes(2)
      await act(async () => window.dispatchEvent(new Event('focus')))
      expect(starts).toHaveBeenCalledTimes(4)
      await act(async () => window.dispatchEvent(new Event('focus')))
      expect(starts).toHaveBeenCalledTimes(7)
      await user.click(
        screen.getByRole('button', { name: 'Silenciar sonidos' }),
      )
      await act(async () => window.dispatchEvent(new Event('focus')))
      expect(starts).toHaveBeenCalledTimes(7)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
