import { useCallback, useEffect, useRef, useState } from 'react'

interface PendingChallenge {
  promise: Promise<string>
  resolve(token: string): void
  reject(error: Error): void
}

export function useTurnstileChallenge(siteKey: string | undefined) {
  const [active, setActive] = useState(false)
  const pending = useRef<PendingChallenge | null>(null)

  const requestToken = useCallback((): Promise<string> => {
    if (!siteKey) return Promise.reject(new Error('configuration_unavailable'))
    if (pending.current) return pending.current.promise
    let resolve!: (token: string) => void
    let reject!: (error: Error) => void
    const promise = new Promise<string>((onSuccess, onFailure) => {
      resolve = onSuccess
      reject = onFailure
    })
    pending.current = { promise, resolve, reject }
    setActive(true)
    return promise
  }, [siteKey])

  const onSuccess = useCallback((token: string) => {
    const challenge = pending.current
    pending.current = null
    setActive(false)
    if (token) challenge?.resolve(token)
    else challenge?.reject(new Error('captcha_unavailable'))
  }, [])

  const onFailure = useCallback(() => {
    const challenge = pending.current
    pending.current = null
    setActive(false)
    challenge?.reject(new Error('captcha_unavailable'))
  }, [])

  useEffect(() => {
    return () => {
      pending.current?.reject(new Error('captcha_unavailable'))
      pending.current = null
    }
  }, [])

  return { active, requestToken, onSuccess, onFailure }
}
