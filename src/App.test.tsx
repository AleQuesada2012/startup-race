import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { RoomApi, RoomState } from './lib/roomApi'

const waitingRoom: RoomState = {
  room: {
    id: 'room-1',
    code: 'ABC234',
    host_id: 'identity-1',
    status: 'waiting',
    phase: null,
    current_player_id: null,
    round: 1,
    version: 1,
    pending_kind: null,
    pending_card_id: null,
    deadline: null,
    result: null,
    expires_at: '2026-09-23T12:00:00Z',
  },
  players: [
    {
      id: 'player-1',
      name: 'Ana',
      entrepreneurship_type: 'technology',
      turn_order: null,
      position: 0,
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
      turn_order: null,
      position: 0,
      capital: 5000,
      reputation: 2,
      innovation: 1,
      is_host: false,
      is_self: false,
    },
  ],
}

function roomApi(overrides: Partial<RoomApi> = {}): RoomApi {
  return {
    ensureIdentity: vi.fn().mockResolvedValue(undefined),
    createRoom: vi.fn().mockResolvedValue(waitingRoom),
    joinRoom: vi.fn().mockResolvedValue(waitingRoom),
    getRoomState: vi.fn().mockRejectedValue(new Error('not_room_member')),
    startGame: vi.fn().mockResolvedValue({
      ...waitingRoom,
      room: { ...waitingRoom.room, status: 'playing', version: 2 },
    }),
    rollDice: vi.fn().mockResolvedValue(waitingRoom),
    chooseOption: vi.fn().mockResolvedValue(waitingRoom),
    resolveTimeout: vi.fn().mockResolvedValue(waitingRoom),
    ...overrides,
  }
}

describe('lobby de Startup Race', () => {
  afterEach(cleanup)
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    window.localStorage.clear()
  })

  it('presenta las entradas públicas para crear o unirse a una Sala', () => {
    render(<App api={roomApi()} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Startup Race' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear una sala' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Unirme con un código' }),
    ).toBeEnabled()
  })

  it('crea una Sala, muestra sus Jugadores y permite iniciar al host', async () => {
    const user = userEvent.setup()
    const api = roomApi()
    render(<App api={api} />)
    await user.click(screen.getByRole('button', { name: 'Crear una sala' }))
    await user.type(screen.getByLabelText('Tu nombre'), 'Ana')
    await user.selectOptions(
      screen.getByLabelText('Tipo de emprendimiento'),
      'technology',
    )
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    expect(
      await screen.findByRole('heading', { name: 'Sala ABC234' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Luis')).toBeInTheDocument()
    expect(api.createRoom).toHaveBeenCalledWith(
      'Ana',
      'technology',
      expect.any(String),
    )
    await user.click(screen.getByRole('button', { name: 'Iniciar partida' }))
    expect(api.startGame).toHaveBeenCalledWith('room-1', 1, expect.any(String))
    expect(
      await screen.findByRole('heading', { name: 'Partida iniciada' }),
    ).toBeInTheDocument()
  })

  it('restaura el asiento de la misma identidad desde el código en la URL', async () => {
    window.history.replaceState({}, '', '/?room=abc234')
    const api = roomApi({
      getRoomState: vi.fn().mockResolvedValue(waitingRoom),
    })
    render(<App api={api} />)
    expect(
      await screen.findByRole('heading', { name: 'Sala ABC234' }),
    ).toBeInTheDocument()
    expect(api.getRoomState).toHaveBeenCalledWith('ABC234')
  })

  it('anuncia en español los errores al unirse', async () => {
    const user = userEvent.setup()
    const api = roomApi({
      joinRoom: vi.fn().mockRejectedValue(new Error('player_name_taken')),
    })
    render(<App api={api} />)
    await user.click(
      screen.getByRole('button', { name: 'Unirme con un código' }),
    )
    await user.type(screen.getByLabelText('Código de sala'), 'ABC234')
    await user.type(screen.getByLabelText('Tu nombre'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Unirme a la sala' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ese nombre ya está en uso en esta sala.',
    )
  })

  it('permite unirse desde el código compartido cuando la identidad aún no ocupa un asiento', async () => {
    window.history.replaceState({}, '', '/?room=abc234')
    const user = userEvent.setup()
    const api = roomApi()
    render(<App api={api} />)
    expect(await screen.findByLabelText('Código de sala')).toHaveValue('ABC234')
    await user.type(screen.getByLabelText('Tu nombre'), 'Bea')
    await user.selectOptions(
      screen.getByLabelText('Tipo de emprendimiento'),
      'social',
    )
    await user.click(screen.getByRole('button', { name: 'Unirme a la sala' }))
    expect(api.joinRoom).toHaveBeenCalledWith(
      'ABC234',
      'Bea',
      'social',
      expect.any(String),
    )
    expect(
      await screen.findByRole('heading', { name: 'Sala ABC234' }),
    ).toBeInTheDocument()
  })

  it('no ofrece iniciar la Partida a un Jugador que no es anfitrión', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    const guestRoom: RoomState = {
      ...waitingRoom,
      players: waitingRoom.players.map((player) => ({
        ...player,
        is_self: player.id === 'player-2',
      })),
    }
    const api = roomApi({ getRoomState: vi.fn().mockResolvedValue(guestRoom) })
    render(<App api={api} />)
    expect(
      await screen.findByRole('heading', { name: 'Sala ABC234' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Iniciar partida' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Esperando a que el anfitrión inicie la partida.'),
    ).toBeInTheDocument()
  })

  it('desactiva iniciar hasta que haya dos Jugadores', async () => {
    const user = userEvent.setup()
    const api = roomApi({
      createRoom: vi.fn().mockResolvedValue({
        ...waitingRoom,
        players: waitingRoom.players.slice(0, 1),
      }),
    })
    render(<App api={api} />)
    await user.click(screen.getByRole('button', { name: 'Crear una sala' }))
    await user.type(screen.getByLabelText('Tu nombre'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    expect(
      await screen.findByRole('button', { name: 'Iniciar partida' }),
    ).toBeDisabled()
  })

  it('actualiza la Sala visible al recuperar el foco sin perder versiones nuevas', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    const newerRoom: RoomState = {
      ...waitingRoom,
      room: { ...waitingRoom.room, version: 2 },
      players: [
        ...waitingRoom.players,
        { ...waitingRoom.players[1], id: 'player-3', name: 'Bea' },
      ],
    }
    const getRoomState = vi
      .fn()
      .mockResolvedValueOnce(waitingRoom)
      .mockResolvedValueOnce(newerRoom)
      .mockResolvedValue(waitingRoom)
    render(<App api={roomApi({ getRoomState })} />)
    expect(
      await screen.findByRole('heading', { name: 'Sala ABC234' }),
    ).toBeInTheDocument()
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByText('Bea')).toBeInTheDocument()
    window.dispatchEvent(new Event('focus'))
    expect(screen.getByText('Bea')).toBeInTheDocument()
  })

  it('muestra validación propia en español para campos vacíos', async () => {
    const user = userEvent.setup()
    render(<App api={roomApi()} />)
    await user.click(screen.getByRole('button', { name: 'Crear una sala' }))
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Escribe un nombre de 1 a 24 caracteres.',
    )
  })

  it('conserva un error de acción cuando llega el mismo estado de la Sala', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/?room=ABC234')
    const api = roomApi({
      getRoomState: vi.fn().mockResolvedValue(waitingRoom),
      startGame: vi.fn().mockRejectedValue(new Error('stale_version')),
    })
    render(<App api={api} />)
    await user.click(
      await screen.findByRole('button', { name: 'Iniciar partida' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La sala cambió. Actualiza e inténtalo de nuevo.',
    )
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La sala cambió. Actualiza e inténtalo de nuevo.',
    )
  })

  it('observa nuevas versiones de una Partida ya iniciada', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    const playingRoom: RoomState = {
      ...waitingRoom,
      room: { ...waitingRoom.room, status: 'playing', version: 2 },
    }
    const nextRound: RoomState = {
      ...playingRoom,
      room: { ...playingRoom.room, version: 3, round: 2 },
    }
    const getRoomState = vi
      .fn()
      .mockResolvedValueOnce(playingRoom)
      .mockResolvedValue(nextRound)
    render(<App api={roomApi({ getRoomState })} />)
    expect(
      await screen.findByRole('heading', { name: 'Partida iniciada' }),
    ).toBeInTheDocument()
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByText('Ronda 2 de 12')).toBeInTheDocument()
  })

  it('reintenta crear una Sala con el mismo ID de solicitud tras perder la respuesta', async () => {
    const user = userEvent.setup()
    const createRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(waitingRoom)
    render(<App api={roomApi({ createRoom })} />)
    await user.click(screen.getByRole('button', { name: 'Crear una sala' }))
    await user.type(screen.getByLabelText('Tu nombre'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Reconectando')
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    expect(
      await screen.findByRole('heading', { name: 'Sala ABC234' }),
    ).toBeInTheDocument()
    expect(createRoom).toHaveBeenCalledTimes(2)
    expect(createRoom.mock.calls[1][2]).toBe(createRoom.mock.calls[0][2])
  })

  it('recuerda el ID de cada creación aunque se intente otro nombre entre reintentos', async () => {
    const user = userEvent.setup()
    const createRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(waitingRoom)
    render(<App api={roomApi({ createRoom })} />)
    await user.click(screen.getByRole('button', { name: 'Crear una sala' }))
    const name = screen.getByLabelText('Tu nombre')
    await user.type(name, 'Ana')
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    await screen.findByRole('status')
    await user.clear(name)
    await user.type(name, 'Bea')
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    await screen.findByRole('alert')
    await user.clear(name)
    await user.type(name, 'Ana')
    await user.click(screen.getByRole('button', { name: 'Crear sala' }))
    await screen.findByRole('heading', { name: 'Sala ABC234' })
    expect(createRoom).toHaveBeenCalledTimes(3)
    expect(createRoom.mock.calls[2][2]).toBe(createRoom.mock.calls[0][2])
    expect(createRoom.mock.calls[2][2]).not.toBe(createRoom.mock.calls[1][2])
  })

  it('anuncia la reconexión durante un fallo de lectura y la retira al recuperarse', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    const getRoomState = vi
      .fn()
      .mockResolvedValueOnce(waitingRoom)
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(waitingRoom)
    render(<App api={roomApi({ getRoomState })} />)
    await screen.findByRole('heading', { name: 'Sala ABC234' })
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByRole('status')).toHaveTextContent('Reconectando')
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByText('Conexión restablecida')).toBeInTheDocument()
  })

  it('no solapa consultas de la Sala al recibir focos repetidos', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    let finishRefresh!: (state: RoomState) => void
    const pendingRefresh = new Promise<RoomState>((resolve) => {
      finishRefresh = resolve
    })
    const getRoomState = vi
      .fn()
      .mockResolvedValueOnce(waitingRoom)
      .mockReturnValueOnce(pendingRefresh)
    render(<App api={roomApi({ getRoomState })} />)
    await screen.findByRole('heading', { name: 'Sala ABC234' })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(getRoomState).toHaveBeenCalledTimes(2)
    await act(async () => finishRefresh(waitingRoom))
  })

  it('serializa una consulta posterior a un comando y otra solicitada por foco', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    let finishCommandRefresh!: (state: RoomState) => void
    const pendingCommandRefresh = new Promise<RoomState>((resolve) => {
      finishCommandRefresh = resolve
    })
    const started: string[] = []
    const getRoomState = vi
      .fn()
      .mockResolvedValueOnce(waitingRoom)
      .mockImplementationOnce(() => {
        started.push('command')
        return pendingCommandRefresh
      })
      .mockImplementationOnce(() => {
        started.push('focus')
        return Promise.resolve(waitingRoom)
      })
    const next: RoomState = {
      ...waitingRoom,
      room: { ...waitingRoom.room, status: 'playing', version: 2 },
    }
    render(
      <App
        api={roomApi({
          getRoomState,
          startGame: vi.fn().mockResolvedValue(next),
        })}
      />,
    )
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Iniciar partida' }),
    )
    expect(started).toEqual(['command'])
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(started).toEqual(['command'])
    await act(async () => finishCommandRefresh(next))
    expect(started).toEqual(['command', 'focus'])
  })

  it('consulta la Sala al volver a una pestaña visible', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    const priorVisibility = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    )
    let visible = true
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    })
    try {
      const getRoomState = vi.fn().mockResolvedValue(waitingRoom)
      render(<App api={roomApi({ getRoomState })} />)
      await screen.findByRole('heading', { name: 'Sala ABC234' })
      visible = false
      await act(async () => window.dispatchEvent(new Event('focus')))
      expect(getRoomState).toHaveBeenCalledTimes(1)
      visible = true
      await act(async () =>
        document.dispatchEvent(new Event('visibilitychange')),
      )
      expect(getRoomState).toHaveBeenCalledTimes(2)
    } finally {
      if (priorVisibility)
        Object.defineProperty(document, 'visibilityState', priorVisibility)
    }
  })

  it('espacia las consultas después de un fallo de red', async () => {
    window.history.replaceState({}, '', '/?room=ABC234')
    vi.useFakeTimers()
    try {
      const getRoomState = vi
        .fn()
        .mockResolvedValueOnce(waitingRoom)
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValue(waitingRoom)
      const view = render(<App api={roomApi({ getRoomState })} />)
      await act(async () => {
        await Promise.resolve()
      })
      expect(
        screen.getByRole('heading', { name: 'Sala ABC234' }),
      ).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(getRoomState).toHaveBeenCalledTimes(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(getRoomState).toHaveBeenCalledTimes(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(getRoomState).toHaveBeenCalledTimes(3)
      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('mantiene los sonidos silenciados hasta que el Jugador los active y recuerda su elección', async () => {
    const user = userEvent.setup()
    const first = render(<App api={roomApi()} />)
    const soundButton = screen.getByRole('button', { name: 'Activar sonidos' })
    expect(soundButton).toHaveAttribute('aria-pressed', 'false')
    await user.click(soundButton)
    expect(
      screen.getByRole('button', { name: 'Silenciar sonidos' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(window.localStorage.getItem('startup-race:sound')).toBe('on')
    first.unmount()
    render(<App api={roomApi()} />)
    await user.click(screen.getByRole('button', { name: 'Silenciar sonidos' }))
    expect(
      screen.getByRole('button', { name: 'Activar sonidos' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(window.localStorage.getItem('startup-race:sound')).toBe('off')
  })
})
