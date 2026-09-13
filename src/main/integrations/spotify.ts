import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { SpotifyOverview } from '@shared/types'
import type { Connector, Env } from './connections'
import { HttpError, TtlCache, getJson } from './http'

export const SPOTIFY_REDIRECT_PORT = 43821
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`
const SCOPES = 'user-read-currently-playing user-read-playback-state user-read-recently-played user-top-read'
const LOGIN_TIMEOUT_MS = 3 * 60_000

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

interface Token {
  access: string
  expires: number
}

/** Spotify account link via OAuth (PKCE, your own Client ID — no secret stored). */
export class SpotifyConnector implements Connector {
  readonly key = 'spotify' as const
  readonly defaultEnabled = false
  readonly syncEveryMs = 60 * 60_000
  private token: Token | null = null
  private readonly overviewCache = new TtlCache<SpotifyOverview | null>(5 * 60_000)

  reset(): void {
    this.token = null
  }

  async sync(env: Env): Promise<void> {
    if (!env.secret('refreshToken')) {
      env.setState({ connected: false })
      return
    }
    const me = await this.api(env, 'me')
    env.setState({ connected: true, account: me?.display_name ?? me?.id ?? 'Spotify', avatar: me?.images?.[0]?.url ?? null })
  }

  /** Opens the Spotify consent page and waits for the redirect back to the app. */
  async login(env: Env): Promise<void> {
    const clientId = env.settings().clientId?.trim()
    const ru = env.language() === 'ru'
    if (!clientId) throw new Error(ru ? 'Сначала укажите Client ID' : 'Enter your Client ID first')
    const verifier = base64url(randomBytes(64))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(16))
    const code = await new Promise<string>((resolve, reject) => {
      let server: Server | null = null
      const finish = (err: Error | null, value?: string): void => {
        clearTimeout(timer)
        server?.close()
        if (err) reject(err)
        else resolve(value!)
      }
      const timer = setTimeout(() => finish(new Error(ru ? 'Время на вход истекло' : 'Sign-in timed out')), LOGIN_TIMEOUT_MS)
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', SPOTIFY_REDIRECT_URI)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const ok = url.searchParams.get('state') === state && url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<meta charset="utf-8"><body style="font:16px system-ui;padding:40px">${
            ok ? (ru ? 'Готово! Можно закрыть вкладку и вернуться в timehub.' : 'Done! You can close this tab and return to timehub.') : 'Error'
          }</body>`
        )
        if (ok) finish(null, url.searchParams.get('code')!)
        else finish(new Error(url.searchParams.get('error') ?? 'Spotify sign-in failed'))
      })
      server.on('error', (err) => finish(err))
      server.listen(SPOTIFY_REDIRECT_PORT, '127.0.0.1', () => {
        const authorize = new URL('https://accounts.spotify.com/authorize')
        authorize.search = new URLSearchParams({
          client_id: clientId,
          response_type: 'code',
          redirect_uri: SPOTIFY_REDIRECT_URI,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          scope: SCOPES,
          state
        }).toString()
        void shell.openExternal(authorize.toString())
      })
    })
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier
    })
    env.setSecret('refreshToken', tokens.refresh_token)
    this.token = { access: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 - 60_000 }
    await this.sync(env)
  }

  /** Top artists and tracks plus recent plays, for the Music section. */
  async overview(env: Env): Promise<SpotifyOverview | null> {
    if (!env.secret('refreshToken')) return null
    const cached = this.overviewCache.get('me')
    if (cached !== undefined) return cached
    const [me, artists, tracks, recent] = await Promise.all([
      this.api(env, 'me'),
      this.api(env, 'me/top/artists?limit=10&time_range=medium_term'),
      this.api(env, 'me/top/tracks?limit=10&time_range=medium_term'),
      this.api(env, 'me/player/recently-played?limit=20')
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img = (images: any[] | undefined): string | null => images?.[images.length > 1 ? 1 : 0]?.url ?? null
    const value: SpotifyOverview = {
      profile: { name: me?.display_name ?? 'Spotify', avatar: img(me?.images), url: me?.external_urls?.spotify ?? null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topArtists: (artists?.items ?? []).map((a: any) => ({ name: a.name, image: img(a.images), url: a.external_urls?.spotify ?? null })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topTracks: (tracks?.items ?? []).map((t: any) => ({
        title: t.name,
        artist: t.artists?.map((a: { name: string }) => a.name).join(', ') ?? '',
        image: img(t.album?.images),
        url: t.external_urls?.spotify ?? null
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recent: (recent?.items ?? []).map((r: any) => ({
        title: r.track?.name ?? '',
        artist: r.track?.artists?.map((a: { name: string }) => a.name).join(', ') ?? '',
        playedAt: Date.parse(r.played_at),
        image: img(r.track?.album?.images)
      }))
    }
    this.overviewCache.set('me', value)
    return value
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async api(env: Env, path: string): Promise<any> {
    const token = await this.accessToken(env)
    try {
      return await getJson(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } })
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) this.token = null
      throw err
    }
  }

  private async accessToken(env: Env): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.access
    const refresh = env.secret('refreshToken')
    const clientId = env.settings().clientId
    if (!refresh || !clientId) throw new Error('Spotify is not connected')
    const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId })
    if (tokens.refresh_token) env.setSecret('refreshToken', tokens.refresh_token)
    this.token = { access: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 - 60_000 }
    return this.token.access
  }

  private tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    return getJson('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    })
  }
}
