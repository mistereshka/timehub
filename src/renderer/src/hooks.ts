import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { ChangeTopic } from '@shared/types'
import { api, errorMessage } from './api'

export interface Query<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload(): void
}

/**
 * Loads data through the API and reloads it whenever the backend reports a
 * change on one of `topics`. Keeps showing the previous data while reloading.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: DependencyList, topics: readonly ChangeTopic[] = []): Query<T> {
  const [state, setState] = useState<{ data?: T; error: string | null; loading: boolean }>({ error: null, loading: true })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const load = useCallback(() => {
    const id = ++seq.current
    fnRef.current().then(
      (data) => {
        if (id === seq.current) setState({ data, error: null, loading: false })
      },
      (err: unknown) => {
        if (id === seq.current) setState((s) => ({ ...s, error: errorMessage(err), loading: false }))
      }
    )
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, deps)

  const topicKey = topics.join(',')
  useEffect(() => {
    if (!topicKey) return
    const wanted = topicKey.split(',')
    return api.onChange((topic) => {
      if (wanted.includes(topic)) load()
    })
  }, [topicKey, load])

  return { data: state.data, error: state.error, loading: state.loading, reload: load }
}

/** Current time, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Wraps an async action with busy/error state for buttons and forms. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): {
  run: (...args: A) => Promise<boolean>
  busy: boolean
  error: string | null
  clearError(): void
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (...args: A): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await fn(...args)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error, clearError: () => setError(null) }
}
