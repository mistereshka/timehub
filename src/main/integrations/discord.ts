import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import type { RunningTimer, TrackerStatus } from '@shared/types'
import type { Connector, Env } from './connections'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2

function frame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(json.length, 4)
  return Buffer.concat([header, json])
}

function tryPipe(index: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(`\\\\?\\pipe\\discord-ipc-${index}`)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

interface Activity {
  details?: string
  state?: string
  timestamps?: { start: number }
  instance?: boolean
}

/**
 * Shows what you're working on as your Discord status (Rich Presence), using
 * the local Discord client's IPC pipe and your own Discord Application ID.
 */
export class DiscordConnector implements Connector {
  readonly key = 'discord' as const
  readonly defaultEnabled = false
  private socket: Socket | null = null
  private ready = false
  private loop: NodeJS.Timeout | null = null
  private lastPayload = ''

  constructor(private readonly snapshot: () => { timer: RunningTimer | null; tracker: TrackerStatus }) {}

  start(env: Env): void {
    this.stop()
    const tick = (): void => void this.update(env)
    this.loop = setInterval(tick, 15_000)
    tick()
  }

  stop(): void {
    if (this.loop) clearInterval(this.loop)
    this.loop = null
    this.close()
  }

  private close(): void {
    this.socket?.destroy()
    this.socket = null
    this.ready = false
    this.lastPayload = ''
  }

  private async ensureConnected(env: Env): Promise<boolean> {
    if (this.socket && this.ready) return true
    const clientId = env.settings().clientId?.trim()
    const ru = env.language() === 'ru'
    if (!clientId) {
      env.setState({ connected: false, error: ru ? 'Укажите Application ID' : 'Enter an Application ID' })
      return false
    }
    for (let i = 0; i < 10; i++) {
      try {
        const socket = await tryPipe(i)
        this.socket = socket
        socket.on('data', (buf: Buffer) => {
          const op = buf.readInt32LE(0)
          try {
            const msg = JSON.parse(buf.subarray(8).toString('utf8'))
            if (msg.evt === 'READY') {
              this.ready = true
              env.setState({ connected: true, error: null, account: msg.data?.user?.global_name ?? msg.data?.user?.username ?? 'Discord' })
            } else if (msg.evt === 'ERROR' || op === OP_CLOSE) {
              env.setState({ connected: false, error: msg.data?.message ?? msg.message ?? 'Discord refused the connection' })
            }
          } catch {
            // ignore partial frames
          }
        })
        socket.on('close', () => this.close())
        socket.on('error', () => this.close())
        socket.write(frame(OP_HANDSHAKE, { v: 1, client_id: clientId }))
        await new Promise((r) => setTimeout(r, 1500))
        if (this.ready) return true
        this.close()
      } catch {
        // try the next pipe
      }
    }
    env.setState({ connected: false, error: ru ? 'Discord не запущен' : 'Discord is not running' })
    return false
  }

  private activity(env: Env): Activity | null {
    const { timer, tracker } = this.snapshot()
    const ru = env.language() === 'ru'
    if (timer) {
      return {
        details: timer.taskNumber != null ? (ru ? 'Работаю над задачей' : 'Working on a task') : ru ? 'Работаю над целью' : 'Working on a goal',
        state: (timer.taskNumber != null ? `#${timer.taskNumber} ${timer.title}` : `🎯 ${timer.title}`).slice(0, 120),
        timestamps: { start: Math.floor(timer.start / 1000) },
        instance: false
      }
    }
    if (env.settings().mode === 'all' && tracker.current) {
      return {
        details: ru ? `В ${tracker.current.displayName}` : `In ${tracker.current.displayName}`,
        state: 'timehub',
        timestamps: { start: Math.floor(tracker.current.since / 1000) },
        instance: false
      }
    }
    return null
  }

  private async update(env: Env): Promise<void> {
    if (!(await this.ensureConnected(env)) || !this.socket) return
    const activity = this.activity(env)
    const payload = JSON.stringify(activity)
    if (payload === this.lastPayload) return
    this.lastPayload = payload
    this.socket.write(frame(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: randomUUID() }))
  }
}
