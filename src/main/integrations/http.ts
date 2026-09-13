const USER_AGENT = 'timehub/0.2 (+https://github.com/mistereshka/timehub)'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

async function request(url: string, opts: RequestOptions, accept: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: accept, ...opts.headers },
      body: opts.body,
      signal: controller.signal
    })
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`.trim())
    return res
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('The service did not respond in time')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getJson<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, opts, 'application/json')
  if (res.status === 204) return null as T
  return (await res.json()) as T
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  return (await request(url, opts, 'text/calendar, text/plain, */*')).text()
}

/** Remembers values for a while; used to keep network calls rare. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>()
  private readonly pending = new Set<string>()

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const e = this.entries.get(key)
    return e && Date.now() - e.at < this.ttlMs ? e.value : undefined
  }

  /** Last known value even if it expired. */
  peek(key: string): V | undefined {
    return this.entries.get(key)?.value
  }

  set(key: string, value: V): void {
    this.entries.set(key, { at: Date.now(), value })
  }

  /**
   * Returns the cached value right away and refreshes it in the background
   * when stale; `onFresh` fires once a new value arrives.
   */
  swr(key: string, load: () => Promise<V>, onFresh?: () => void): V | undefined {
    if (this.get(key) === undefined && !this.pending.has(key)) {
      this.pending.add(key)
      load()
        .then((value) => {
          this.set(key, value)
          onFresh?.()
        })
        .catch(() => {})
        .finally(() => this.pending.delete(key))
    }
    return this.peek(key)
  }
}
