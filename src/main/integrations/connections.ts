import { safeStorage } from 'electron'
import type { Service } from '@shared/service'
import type { ChangeTopic, ConnectionKey, ConnectionPatch, ConnectionStatus, Lang } from '@shared/types'

export interface ConnectorState {
  connected?: boolean
  account?: string | null
  avatar?: string | null
  detail?: string | null
  error?: string | null
  lastSync?: number | null
}

/** What a connector may touch: its own settings, secrets and status. */
export interface Env {
  readonly service: Service
  settings(): Record<string, string>
  secret(name: string): string | null
  setSecret(name: string, value: string | null): void
  setState(state: ConnectorState): void
  broadcast(topic: ChangeTopic): void
  language(): Lang
}

export interface Connector {
  readonly key: ConnectionKey
  /** On unless the user turns it off (local, no account needed) */
  readonly defaultEnabled: boolean
  readonly syncEveryMs?: number
  start?(env: Env): void | Promise<void>
  stop?(): void
  sync?(env: Env): Promise<void>
  /** Forget in-memory account data on disconnect */
  reset?(): void
}

// Secrets are encrypted with the OS keychain (DPAPI on Windows) before they touch the database.
function encrypt(value: string): string {
  return safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(value).toString('base64')}` : `plain:${value}`
}

function decrypt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch {
      return null
    }
  }
  return value.startsWith('plain:') ? value.slice(6) : null
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Owns every connector: settings, secrets, sync schedule and status for the UI. */
export class Connections {
  private readonly connectors = new Map<ConnectionKey, Connector>()
  private readonly timers = new Map<ConnectionKey, NodeJS.Timeout>()
  private readonly running = new Set<ConnectionKey>()

  constructor(
    private readonly service: Service,
    private readonly broadcast: (topic: ChangeTopic) => void
  ) {}

  register(...list: Connector[]): void {
    for (const c of list) this.connectors.set(c.key, c)
  }

  get<C extends Connector>(key: ConnectionKey): C {
    const c = this.connectors.get(key)
    if (!c) throw new Error(`Unknown connection: ${key}`)
    return c as C
  }

  isEnabled(key: ConnectionKey): boolean {
    const row = this.service.getIntegration(key)
    return row.updatedAt === 0 ? (this.connectors.get(key)?.defaultEnabled ?? false) : row.enabled
  }

  env(key: ConnectionKey): Env {
    const config = (): Record<string, unknown> => this.service.getIntegration(key).config
    return {
      service: this.service,
      settings: () => (config().settings ?? {}) as Record<string, string>,
      secret: (name) => decrypt((config().secrets as Record<string, unknown> | undefined)?.[name]),
      setSecret: (name, value) => {
        const secrets = { ...((config().secrets as Record<string, string> | undefined) ?? {}) }
        if (value == null) delete secrets[name]
        else secrets[name] = encrypt(value)
        this.service.saveIntegration(key, { enabled: this.isEnabled(key), config: { secrets } })
      },
      setState: (state) => this.service.saveIntegration(key, { enabled: this.isEnabled(key), state: { ...state } }),
      broadcast: this.broadcast,
      language: () => this.service.getSettings().language
    }
  }

  async startAll(): Promise<void> {
    for (const key of this.connectors.keys()) if (this.isEnabled(key)) await this.startOne(key)
  }

  stopAll(): void {
    for (const key of [...this.running]) this.stopOne(key)
  }

  list(): ConnectionStatus[] {
    return [...this.connectors.keys()].map((key) => this.status(key))
  }

  status(key: ConnectionKey): ConnectionStatus {
    const row = this.service.getIntegration(key)
    const state = row.state as ConnectorState
    return {
      key,
      enabled: this.isEnabled(key),
      connected: Boolean(state.connected),
      account: state.account ?? null,
      avatar: state.avatar ?? null,
      detail: state.detail ?? null,
      error: state.error ?? null,
      lastSync: state.lastSync ?? null,
      settings: (row.config.settings ?? {}) as Record<string, string>,
      secretsSet: Object.keys((row.config.secrets as Record<string, string> | undefined) ?? {})
    }
  }

  async update(key: ConnectionKey, patch: ConnectionPatch): Promise<ConnectionStatus> {
    const config = this.service.getIntegration(key).config
    const settings = { ...((config.settings as Record<string, string> | undefined) ?? {}), ...patch.settings }
    const secrets = { ...((config.secrets as Record<string, string> | undefined) ?? {}) }
    for (const [name, value] of Object.entries(patch.secrets ?? {})) {
      if (value == null || value === '') delete secrets[name]
      else secrets[name] = encrypt(value)
    }
    const enabled = patch.enabled ?? this.isEnabled(key)
    this.service.saveIntegration(key, { enabled, config: { settings, secrets } })
    this.stopOne(key)
    if (enabled) await this.startOne(key)
    else this.env(key).setState({ connected: false, error: null })
    return this.status(key)
  }

  async sync(key: ConnectionKey): Promise<ConnectionStatus> {
    await this.runSync(key)
    return this.status(key)
  }

  disconnect(key: ConnectionKey): ConnectionStatus {
    this.stopOne(key)
    this.connectors.get(key)?.reset?.()
    this.service.saveIntegration(key, {
      enabled: false,
      config: { settings: {}, secrets: {} },
      state: { connected: false, account: null, avatar: null, detail: null, error: null, lastSync: null }
    })
    return this.status(key)
  }

  private async startOne(key: ConnectionKey): Promise<void> {
    const c = this.connectors.get(key)
    if (!c || this.running.has(key)) return
    this.running.add(key)
    try {
      await c.start?.(this.env(key))
    } catch (err) {
      this.fail(key, err)
    }
    if (c.sync) {
      void this.runSync(key)
      if (c.syncEveryMs) this.timers.set(key, setInterval(() => void this.runSync(key), c.syncEveryMs))
    }
  }

  private stopOne(key: ConnectionKey): void {
    const timer = this.timers.get(key)
    if (timer) clearInterval(timer)
    this.timers.delete(key)
    if (this.running.delete(key)) this.connectors.get(key)?.stop?.()
  }

  private async runSync(key: ConnectionKey): Promise<void> {
    const c = this.connectors.get(key)
    if (!c?.sync) return
    try {
      await c.sync(this.env(key))
      this.env(key).setState({ error: null, lastSync: Date.now() })
    } catch (err) {
      this.fail(key, err)
    }
  }

  private fail(key: ConnectionKey, err: unknown): void {
    console.error(`[connections:${key}]`, errorText(err))
    this.env(key).setState({ error: errorText(err) })
  }
}
