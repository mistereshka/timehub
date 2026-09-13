import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppLink } from '@shared/types'
import type { Connector, Env } from './connections'

const MANIFESTS = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'

interface EpicApp {
  appName: string
  name: string
  installDir: string
}

/** Epic Games: names of locally installed games (from the launcher's manifests). */
export class EpicConnector implements Connector {
  readonly key = 'epic' as const
  readonly defaultEnabled = true
  readonly syncEveryMs = 60 * 60_000
  private apps: EpicApp[] = []

  async sync(env: Env): Promise<void> {
    const apps: EpicApp[] = []
    let files: string[] = []
    try {
      files = (await readdir(MANIFESTS)).filter((f) => f.endsWith('.item'))
    } catch {
      files = []
    }
    for (const f of files) {
      try {
        const m = JSON.parse(await readFile(join(MANIFESTS, f), 'utf8'))
        if (m.DisplayName && m.InstallLocation && !m.bIsIncompleteInstall) {
          apps.push({ appName: m.AppName ?? f, name: m.DisplayName, installDir: m.InstallLocation })
        }
      } catch {
        // skip unreadable manifests
      }
    }
    this.apps = apps
    for (const app of env.service.listApps()) {
      const ea = this.appForPath(app.exePath)
      if (ea && !env.service.getAppLink(app.id)) env.service.setAppLink(this.linkFor(app.id, ea))
    }
    const ru = env.language() === 'ru'
    env.setState({ connected: apps.length > 0, detail: apps.length ? (ru ? `${apps.length} игр установлено` : `${apps.length} games installed`) : null })
  }

  appForPath(exePath: string): EpicApp | null {
    const path = exePath.toLowerCase()
    return this.apps.find((a) => path.startsWith(`${a.installDir.toLowerCase().replace(/[\\/]+$/, '')}\\`)) ?? null
  }

  linkFor(appId: number, ea: EpicApp): AppLink {
    return { appId, provider: 'epic', externalId: ea.appName, name: ea.name, imageUrl: null, storeUrl: null }
  }
}
