import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type EntrepreneurshipType = 'technology' | 'social' | 'traditional'
export interface RoomPlayer {
  id: string
  name: string
  entrepreneurship_type: EntrepreneurshipType
  turn_order: number | null
  position: number
  capital: number
  reputation: number
  innovation: number
  is_host: boolean
  is_self: boolean
}
export interface RoomState {
  room: {
    id: string
    code: string
    host_id: string
    status: 'waiting' | 'playing' | 'finished' | 'expired'
    phase: 'waiting_for_roll' | 'waiting_for_choice' | null
    current_player_id: string | null
    round: number
    version: number
    pending_kind: 'card' | 'management' | null
    pending_card_id: string | null
    deadline: string | null
    result: unknown
    expires_at: string
  }
  players: RoomPlayer[]
}
export interface RoomApi {
  ensureIdentity(): Promise<void>
  createRoom(
    name: string,
    type: EntrepreneurshipType,
    requestId: string,
  ): Promise<RoomState>
  joinRoom(
    code: string,
    name: string,
    type: EntrepreneurshipType,
    requestId: string,
  ): Promise<RoomState>
  getRoomState(code: string): Promise<RoomState>
  startGame(
    roomId: string,
    expectedVersion: number,
    requestId: string,
  ): Promise<RoomState>
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  if (!data) throw new Error('empty_response')
  return data
}

function createRoomApi(client: SupabaseClient): RoomApi {
  return {
    async ensureIdentity() {
      const { data, error } = await client.auth.getSession()
      if (error) throw new Error(error.message)
      if (!data.session) {
        const { error: signInError } = await client.auth.signInAnonymously()
        if (signInError) throw new Error(signInError.message)
      }
    },
    async createRoom(name, type, requestId) {
      const { data, error } = await client.rpc('create_room', {
        name,
        entrepreneurship_type: type,
        request_id: requestId,
      })
      return unwrap(data as RoomState | null, error)
    },
    async joinRoom(code, name, type, requestId) {
      const { data, error } = await client.rpc('join_room', {
        code,
        name,
        entrepreneurship_type: type,
        request_id: requestId,
      })
      return unwrap(data as RoomState | null, error)
    },
    async getRoomState(code) {
      const { data, error } = await client.rpc('get_room_state', { code })
      return unwrap(data as RoomState | null, error)
    },
    async startGame(roomId, expectedVersion, requestId) {
      const { data, error } = await client.rpc('start_game', {
        room_id: roomId,
        expected_version: expectedVersion,
        request_id: requestId,
      })
      return unwrap(data as RoomState | null, error)
    },
  }
}

let defaultApi: RoomApi | undefined
export function getDefaultRoomApi(): RoomApi {
  if (defaultApi) return defaultApi
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    const unavailable = async () => {
      throw new Error('configuration_unavailable')
    }
    defaultApi = {
      ensureIdentity: unavailable,
      createRoom: unavailable,
      joinRoom: unavailable,
      getRoomState: unavailable,
      startGame: unavailable,
    }
    return defaultApi
  }
  defaultApi = createRoomApi(createClient(url, key))
  return defaultApi
}
