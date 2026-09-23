import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createRoomApi } from './roomApi'

describe('anonymous Room identity', () => {
  it('sends a fresh Turnstile token to Supabase when creating an identity', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    })
    const signInAnonymously = vi.fn().mockResolvedValue({ error: null })
    const client = {
      auth: { getSession, signInAnonymously },
    } as unknown as SupabaseClient
    const requestCaptchaToken = vi.fn().mockResolvedValue('fresh-token')

    await createRoomApi(client).ensureIdentity(requestCaptchaToken)

    expect(requestCaptchaToken).toHaveBeenCalledOnce()
    expect(signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: 'fresh-token' },
    })
  })

  it('restores an existing identity without asking for another challenge', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'existing-session' } },
      error: null,
    })
    const signInAnonymously = vi.fn()
    const client = {
      auth: { getSession, signInAnonymously },
    } as unknown as SupabaseClient
    const requestCaptchaToken = vi.fn()

    await createRoomApi(client).ensureIdentity(requestCaptchaToken)

    expect(requestCaptchaToken).not.toHaveBeenCalled()
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it('shares one challenge when two actions request identity together', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    })
    const signInAnonymously = vi.fn().mockResolvedValue({ error: null })
    const client = {
      auth: { getSession, signInAnonymously },
    } as unknown as SupabaseClient
    const api = createRoomApi(client)
    const requestCaptchaToken = vi.fn().mockResolvedValue('one-use-token')

    await Promise.all([
      api.ensureIdentity(requestCaptchaToken),
      api.ensureIdentity(requestCaptchaToken),
    ])

    expect(requestCaptchaToken).toHaveBeenCalledOnce()
    expect(signInAnonymously).toHaveBeenCalledOnce()
  })
})
