import { useId, useState, type ReactNode } from 'react'
import { Button, Checkbox, Flash, Label, SegmentedControl, Select } from '@primer/react'
import { BellIcon, DownloadIcon, FileDirectoryIcon, MarkGithubIcon } from '@primer/octicons-react'
import { Link } from 'react-router'
import type { ThemeSetting } from '@shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { useAction } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { ErrorFlash } from '../components/common'

const THEMES: ThemeSetting[] = ['system', 'light', 'dark', 'dark_dimmed']
const POLL_SECONDS = [2, 5, 10, 15, 30]
const IDLE_MINUTES = [1, 2, 3, 5, 10, 15, 30]
const REMIND_MINUTES = [0, 5, 10, 15, 30]
const REPO_URL = 'https://github.com/mistereshka/timehub'

export function SettingsPage(): ReactNode {
  const { settings, updateSettings, meta } = useApp()
  const { t } = useI18n()
  const [exported, setExported] = useState<string | null>(null)
  const [tested, setTested] = useState<boolean | null>(null)
  const testReminder = useAction(async () => setTested(await api.testReminder()))
  const exportData = useAction(async (format: 'json' | 'csv') => {
    const path = await api.exportData(format)
    if (path) setExported(path)
  })

  return (
    <div className="container container-narrow settings">
      <h1 className="page-title mb-3">{t('settings.title')}</h1>

      <h2 className="subhead">{t('settings.appearance')}</h2>
      <SettingRow title={t('settings.theme')}>
        <SegmentedControl aria-label={t('settings.theme')} onChange={(i) => void updateSettings({ theme: THEMES[i] })}>
          {THEMES.map((theme) => (
            <SegmentedControl.Button key={theme} selected={settings.theme === theme}>
              {t(`settings.theme.${theme}` as MessageKey)}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
      </SettingRow>
      <SettingRow title={t('settings.language')}>
        <SegmentedControl aria-label={t('settings.language')} onChange={(i) => void updateSettings({ language: i === 0 ? 'ru' : 'en' })}>
          <SegmentedControl.Button selected={settings.language === 'ru'}>Русский</SegmentedControl.Button>
          <SegmentedControl.Button selected={settings.language === 'en'}>English</SegmentedControl.Button>
        </SegmentedControl>
      </SettingRow>
      <SettingRow title={t('settings.weekStart')}>
        <Select value={String(settings.weekStartsOn)} onChange={(e) => void updateSettings({ weekStartsOn: e.target.value === '0' ? 0 : 1 })}>
          <Select.Option value="1">{t('settings.monday')}</Select.Option>
          <Select.Option value="0">{t('settings.sunday')}</Select.Option>
        </Select>
      </SettingRow>

      <h2 className="subhead">{t('settings.tracking')}</h2>
      <p className="muted">{t('settings.trackingHint')}</p>
      <CheckRow
        checked={settings.trackingPaused}
        onChange={(v) => updateSettings({ trackingPaused: v })}
        title={t('settings.pause')}
        hint={t('settings.pauseHint')}
      />
      <SettingRow title={t('settings.poll')} hint={t('settings.pollHint')}>
        <Select value={String(settings.pollIntervalSec)} onChange={(e) => void updateSettings({ pollIntervalSec: Number(e.target.value) })}>
          {POLL_SECONDS.map((s) => (
            <Select.Option key={s} value={String(s)}>
              {t('settings.seconds', { n: s })}
            </Select.Option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow title={t('settings.idle')} hint={t('settings.idleHint')}>
        <Select value={String(settings.idleThresholdMin)} onChange={(e) => void updateSettings({ idleThresholdMin: Number(e.target.value) })}>
          {IDLE_MINUTES.map((m) => (
            <Select.Option key={m} value={String(m)}>
              {t('settings.minutes', { n: m })}
            </Select.Option>
          ))}
        </Select>
      </SettingRow>
      <p className="small">
        <Link to="/activity">{t('settings.appsLink')}</Link>
      </p>

      <h2 className="subhead">{t('settings.system')}</h2>
      <CheckRow
        checked={settings.autostart}
        onChange={(v) => updateSettings({ autostart: v })}
        title={t('settings.autostart')}
        hint={meta.packaged ? t('settings.autostartHint') : t('settings.autostartDev')}
      />
      <CheckRow
        checked={settings.closeToTray}
        onChange={(v) => updateSettings({ closeToTray: v })}
        title={t('settings.closeToTray')}
        hint={t('settings.closeToTrayHint')}
      />

      <h2 className="subhead">{t('settings.reminders')}</h2>
      <CheckRow
        checked={settings.reminders}
        onChange={(v) => updateSettings({ reminders: v })}
        title={t('settings.remindersOn')}
        hint={t('settings.remindersHint')}
      />
      <SettingRow title={t('settings.remindBefore')}>
        <Select
          value={String(settings.remindBeforeMin)}
          disabled={!settings.reminders}
          onChange={(e) => void updateSettings({ remindBeforeMin: Number(e.target.value) })}
        >
          {REMIND_MINUTES.map((m) => (
            <Select.Option key={m} value={String(m)}>
              {m === 0 ? t('settings.remindAtStart') : t('settings.remindMin', { n: m })}
            </Select.Option>
          ))}
        </Select>
      </SettingRow>
      <div className="row row-wrap mt-2">
        <Button leadingVisual={BellIcon} disabled={!settings.reminders || testReminder.busy} onClick={() => void testReminder.run()}>
          {t('settings.remindTest')}
        </Button>
        {tested != null && <span className="small muted">{tested ? t('settings.remindTestSent') : t('settings.remindUnsupported')}</span>}
      </div>
      <ErrorFlash error={testReminder.error} />

      <h2 className="subhead">{t('settings.data')}</h2>
      <p className="muted">{t('settings.dataHint')}</p>
      <div className="row row-wrap">
        <Button leadingVisual={DownloadIcon} onClick={() => void exportData.run('json')}>
          {t('settings.exportJson')}
        </Button>
        <Button leadingVisual={DownloadIcon} onClick={() => void exportData.run('csv')}>
          {t('settings.exportCsv')}
        </Button>
        {!meta.demo && (
          <Button leadingVisual={FileDirectoryIcon} onClick={() => void api.openDataFolder()}>
            {t('settings.openFolder')}
          </Button>
        )}
      </div>
      {exported && (
        <Flash variant="success" className="mt-2">
          {t('settings.exported', { path: exported })}
        </Flash>
      )}
      <ErrorFlash error={exportData.error} />
      <p className="small muted mt-2">
        {t('settings.dataPath')}: <code className="mono">{meta.dataPath}</code>
      </p>

      <h2 className="subhead">{t('settings.about')}</h2>
      <p className="row">
        <strong>timehub</strong> v{meta.version}
        {meta.demo && <Label variant="attention">{t('settings.demo')}</Label>}
      </p>
      {meta.demo && <p className="muted small">{t('settings.demoHint')}</p>}
      <p className="small">
        <a
          href={REPO_URL}
          className="row"
          onClick={(e) => {
            e.preventDefault()
            void api.openExternal(REPO_URL)
          }}
        >
          <MarkGithubIcon /> github.com/mistereshka/timehub
        </a>
      </p>
    </div>
  )
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div className="setting-row">
      <div className="grow">
        <div className="bold">{title}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function CheckRow({
  checked,
  onChange,
  title,
  hint
}: {
  checked: boolean
  onChange(value: boolean): Promise<void>
  title: string
  hint?: string
}): ReactNode {
  const id = useId()
  return (
    <div className="setting-row">
      <Checkbox id={id} checked={checked} onChange={(e) => void onChange(e.target.checked)} />
      <label htmlFor={id} className="grow">
        <div className="bold">{title}</div>
        {hint && <div className="small muted">{hint}</div>}
      </label>
    </div>
  )
}
