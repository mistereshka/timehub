import { useEffect, useState, type ReactNode } from 'react'
import { Avatar, Button, Checkbox, Flash, IconButton, Label, Select, TextInput } from '@primer/react'
import { CopyIcon, LinkExternalIcon, PlusIcon, SyncIcon, TrashIcon } from '@primer/octicons-react'
import type { CalendarSourceConfig, ConnectionKey, ConnectionStatus } from '@shared/types'
import { COLOR_PALETTE } from '@shared/catalog'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { ErrorFlash, Field } from '../components/common'

interface FieldDef {
  name: string
  label: MessageKey
  secret?: boolean
  placeholder?: string
  options?: { value: string; label: MessageKey }[]
}
interface Def {
  key: ConnectionKey
  icon: string
  group: 'games' | 'media' | 'library' | 'work'
  fields: FieldDef[]
  help?: { url: string; label: MessageKey }
}

const SPOTIFY_REDIRECT = 'http://127.0.0.1:43821/callback'

const DEFS: Def[] = [
  {
    key: 'steam', icon: '🎮', group: 'games',
    fields: [
      { name: 'apiKey', label: 'conn.field.steamKey', secret: true },
      { name: 'steamId', label: 'conn.field.steamId', placeholder: '7656119…, 7656119…' }
    ],
    help: { url: 'https://steamcommunity.com/dev/apikey', label: 'conn.help.steam' }
  },
  { key: 'roblox', icon: '🧱', group: 'games', fields: [{ name: 'username', label: 'conn.field.robloxUser' }] },
  { key: 'epic', icon: '🛡️', group: 'games', fields: [] },
  { key: 'media', icon: '🎵', group: 'media', fields: [] },
  {
    key: 'spotify', icon: '🟢', group: 'media', fields: [{ name: 'clientId', label: 'conn.field.spotifyClient' }],
    help: { url: 'https://developer.spotify.com/dashboard', label: 'conn.help.spotify' }
  },
  {
    key: 'discord', icon: '💬', group: 'media',
    fields: [
      { name: 'clientId', label: 'conn.field.discordApp' },
      { name: 'mode', label: 'conn.field.discordMode', options: [{ value: 'timer', label: 'conn.mode.timer' }, { value: 'all', label: 'conn.mode.all' }] }
    ],
    help: { url: 'https://discord.com/developers/applications', label: 'conn.help.discord' }
  },
  { key: 'anilib', icon: '📺', group: 'library', fields: [{ name: 'profile', label: 'conn.field.anilibProfile', placeholder: 'https://anilib.me/ru/user/…' }] },
  { key: 'shikimori', icon: '🦊', group: 'library', fields: [{ name: 'nickname', label: 'conn.field.shikiNick' }] },
  {
    key: 'tmdb', icon: '🎬', group: 'library', fields: [{ name: 'apiKey', label: 'conn.field.tmdbKey', secret: true }],
    help: { url: 'https://www.themoviedb.org/settings/api', label: 'conn.help.tmdb' }
  },
  {
    key: 'github', icon: '🐙', group: 'work',
    fields: [
      { name: 'username', label: 'conn.field.githubUser' },
      { name: 'token', label: 'conn.field.githubToken', secret: true }
    ],
    help: { url: 'https://github.com/settings/tokens', label: 'conn.help.github' }
  },
  { key: 'calendar', icon: '📅', group: 'work', fields: [] }
]
const GROUPS: Def['group'][] = ['games', 'media', 'library', 'work']

/** Like Discord's Connections: games, music, lists and work services. */
export function ConnectionsPage(): ReactNode {
  const { t } = useI18n()
  const { meta } = useApp()
  const list = useQuery(() => api.listConnections(), [], ['connections'])
  const byKey = new Map((list.data ?? []).map((c) => [c.key, c]))
  return (
    <div className="container">
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">{t('conn.title')}</h1>
          <div className="muted">{t('conn.subtitle')}</div>
        </div>
      </div>
      {meta.demo && <Flash className="mb-3">{t('conn.demo')}</Flash>}
      {GROUPS.map((g) => (
        <section key={g} className="mb-3">
          <h2 className="subhead">{t(`conn.group.${g}` as MessageKey)}</h2>
          <div className="conn-grid">
            {DEFS.filter((d) => d.group === g).map((d) => {
              const status = byKey.get(d.key)
              return status ? <ConnectionCard key={d.key} def={d} status={status} /> : null
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function ConnectionCard({ def, status }: { def: Def; status: ConnectionStatus }): ReactNode {
  const { t, ago } = useI18n()
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    setValues(Object.fromEntries(def.fields.filter((f) => !f.secret).map((f) => [f.name, status.settings[f.name] ?? ''])))
  }, [def, status.settings])
  const [sources, setSources] = useState<CalendarSourceConfig[]>(() => parseSources(status.settings.sources))
  const dirty = def.fields.some((f) => (f.secret ? !!values[f.name] : (values[f.name] ?? '') !== (status.settings[f.name] ?? '')))

  const save = useAction(async () => {
    const settings: Record<string, string> = {}
    const secrets: Record<string, string> = {}
    for (const f of def.fields) {
      if (f.secret) {
        if (values[f.name]) secrets[f.name] = values[f.name]
      } else settings[f.name] = values[f.name] ?? ''
    }
    if (def.key === 'calendar') settings.sources = JSON.stringify(sources.filter((s) => s.url.trim()))
    await api.updateConnection(def.key, { enabled: true, settings, secrets })
    setValues((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !def.fields.find((f) => f.name === k)?.secret)))
  })
  const toggle = useAction((enabled: boolean) => api.updateConnection(def.key, { enabled }))
  const sync = useAction(() => api.syncConnection(def.key))
  const disconnect = useAction(() => api.disconnectConnection(def.key))
  const login = useAction(() => api.connectSpotify())

  const badge = status.error ? (
    <Label variant="danger">{t('conn.error')}</Label>
  ) : status.enabled && status.connected ? (
    <Label variant="success">{t('conn.connected')}</Label>
  ) : status.enabled ? (
    <Label variant="attention">{t('conn.pending')}</Label>
  ) : (
    <Label variant="secondary">{t('conn.off')}</Label>
  )

  return (
    <div className="box conn-card">
      <div className="conn-head">
        <span className="conn-icon">{def.icon}</span>
        <div className="grow">
          <div className="row">
            <span className="bold">{t(`conn.${def.key}.name` as MessageKey)}</span>
            {badge}
          </div>
          <div className="small muted">{t(`conn.${def.key}.desc` as MessageKey)}</div>
        </div>
        <label className="check-field small" title={t('conn.enabled')}>
          <Checkbox checked={status.enabled} onChange={(e) => void toggle.run(e.target.checked)} />
        </label>
      </div>
      {(status.account || status.detail) && (
        <div className="conn-account">
          {status.avatar && <Avatar src={status.avatar} size={28} />}
          <div className="grow" style={{ minWidth: 0 }}>
            {status.account && <div className="bold truncate">{status.account}</div>}
            {status.detail && <div className="small muted truncate">{status.detail}</div>}
          </div>
        </div>
      )}
      {status.error && (
        <Flash variant="danger" className="small">
          {status.error}
        </Flash>
      )}
      <ErrorFlash error={save.error ?? toggle.error ?? sync.error ?? disconnect.error ?? login.error} />

      {def.fields.map((f) => (
        <Field key={f.name} label={t(f.label)}>
          {f.options ? (
            <Select block value={values[f.name] || f.options[0].value} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
              {f.options.map((o) => (
                <Select.Option key={o.value} value={o.value}>
                  {t(o.label)}
                </Select.Option>
              ))}
            </Select>
          ) : (
            <TextInput
              block
              type={f.secret ? 'password' : 'text'}
              value={values[f.name] ?? ''}
              placeholder={f.secret && status.secretsSet.includes(f.name) ? t('conn.secretSet') : (f.placeholder ?? '')}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          )}
        </Field>
      ))}

      {def.key === 'calendar' && <CalendarSources value={sources} onChange={setSources} />}

      {def.key === 'spotify' && (
        <div className="small">
          <span className="muted">{t('conn.redirect')}</span>{' '}
          <code className="mono">{SPOTIFY_REDIRECT}</code>{' '}
          <IconButton icon={CopyIcon} size="small" variant="invisible" aria-label={t('conn.copy')} onClick={() => void navigator.clipboard.writeText(SPOTIFY_REDIRECT)} />
        </div>
      )}

      {def.help && (
        <button type="button" className="link-button small" onClick={() => void api.openExternal(def.help!.url)}>
          <LinkExternalIcon size={12} /> {t(def.help.label)}
        </button>
      )}

      <div className="conn-actions">
        {(def.fields.length > 0 || def.key === 'calendar') && (
          <Button size="small" variant="primary" disabled={save.busy || (!dirty && def.key !== 'calendar')} onClick={() => void save.run()}>
            {status.connected ? t('common.save') : t('conn.connect')}
          </Button>
        )}
        {def.key === 'spotify' && (
          <Button size="small" disabled={login.busy || !status.settings.clientId} onClick={() => void login.run()}>
            {t('conn.spotifyLogin')}
          </Button>
        )}
        {status.enabled && (
          <Button size="small" leadingVisual={SyncIcon} disabled={sync.busy} onClick={() => void sync.run()}>
            {t('conn.sync')}
          </Button>
        )}
        {(status.connected || status.secretsSet.length > 0) && (
          <Button size="small" variant="invisible" onClick={() => void disconnect.run()}>
            <span className="fg-danger">{t('conn.disconnect')}</span>
          </Button>
        )}
        <span className="grow" />
        {status.lastSync && <span className="small muted">{t('conn.lastSync', { ago: ago(status.lastSync) })}</span>}
      </div>
    </div>
  )
}

function parseSources(raw: string | undefined): CalendarSourceConfig[] {
  try {
    const list = JSON.parse(raw || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function CalendarSources({ value, onChange }: { value: CalendarSourceConfig[]; onChange(v: CalendarSourceConfig[]): void }): ReactNode {
  const { t } = useI18n()
  const update = (i: number, patch: Partial<CalendarSourceConfig>): void => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div className="stack stack-sm">
      {value.length === 0 && <div className="small muted">{t('conn.cal.empty')}</div>}
      {value.map((s, i) => (
        <div key={s.id} className="calendar-source">
          <input type="color" className="color-input" value={s.color} onChange={(e) => update(i, { color: e.target.value })} aria-label={t('labels.color')} />
          <TextInput className="w-140" value={s.name} placeholder={t('conn.cal.name')} onChange={(e) => update(i, { name: e.target.value })} />
          <div className="grow">
            <TextInput block value={s.url} placeholder={t('conn.cal.url')} onChange={(e) => update(i, { url: e.target.value })} />
          </div>
          <IconButton icon={TrashIcon} size="small" variant="invisible" aria-label={t('common.delete')} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div>
        <Button
          size="small"
          leadingVisual={PlusIcon}
          onClick={() =>
            onChange([...value, { id: `cal${Date.now().toString(36)}`, name: '', url: '', color: COLOR_PALETTE[(value.length * 3 + 5) % COLOR_PALETTE.length] }])
          }
        >
          {t('conn.cal.add')}
        </Button>
      </div>
    </div>
  )
}
