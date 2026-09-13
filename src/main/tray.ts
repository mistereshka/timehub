import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { Service } from '@shared/service'
import type { Lang, TrackerStatus } from '@shared/types'
import { formatClock, formatDuration, todayKey } from '@shared/time'

const TEXT = {
  en: {
    open: 'Open timehub',
    stop: 'Stop timer',
    start: 'Start timer',
    noTasks: 'No open tasks',
    pause: 'Pause tracking',
    quit: 'Quit',
    paused: 'tracking paused',
    idle: 'idle',
    locked: 'locked'
  },
  ru: {
    open: 'Открыть timehub',
    stop: 'Остановить таймер',
    start: 'Запустить таймер',
    noTasks: 'Нет открытых задач',
    pause: 'Пауза трекинга',
    quit: 'Выход',
    paused: 'трекинг на паузе',
    idle: 'не активен',
    locked: 'заблокирован'
  }
} satisfies Record<Lang, Record<string, string>>

export interface TrayOptions {
  service: Service
  icon: string
  pausedIcon: string
  getStatus(): TrackerStatus
  onOpen(): void
  onQuit(): void
}

/** Tray icon: left click opens the window, right click shows a menu built on demand. */
export function createTray(o: TrayOptions): { refresh(): void } {
  const images = { normal: nativeImage.createFromPath(o.icon), paused: nativeImage.createFromPath(o.pausedIcon) }
  const tray = new Tray(images.normal)

  const buildMenu = (): Menu => {
    const settings = o.service.getSettings()
    const t = TEXT[settings.language]
    const timer = o.service.getRunningTimer()
    const items: MenuItemConstructorOptions[] = [{ label: t.open, click: o.onOpen }, { type: 'separator' }]
    if (timer) {
      items.push({
        label: `${t.stop}: ${timer.taskNumber != null ? `#${timer.taskNumber} ` : '🎯 '}${timer.title} (${formatClock(Date.now() - timer.start)})`,
        click: () => o.service.stopTimer()
      })
    } else {
      const today = todayKey()
      const tasks = o.service
        .listTasks({ status: 'open' })
        .sort((a, b) => Number(b.plannedDate === today) - Number(a.plannedDate === today) || b.updatedAt - a.updatedAt)
        .slice(0, 10)
      items.push({
        label: t.start,
        submenu: tasks.length
          ? tasks.map((task) => ({ label: `#${task.number} ${task.title}`, click: () => o.service.startTimer(task.id) }))
          : [{ label: t.noTasks, enabled: false }]
      })
    }
    items.push(
      {
        label: t.pause,
        type: 'checkbox',
        checked: settings.trackingPaused,
        click: (item) => o.service.updateSettings({ trackingPaused: item.checked })
      },
      { type: 'separator' },
      { label: t.quit, click: o.onQuit }
    )
    return Menu.buildFromTemplate(items)
  }

  tray.on('click', o.onOpen)
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()))

  const refresh = (): void => {
    const settings = o.service.getSettings()
    const t = TEXT[settings.language]
    const status = o.getStatus()
    const timer = o.service.getRunningTimer()
    const parts = ['timehub']
    if (timer) parts.push(`⏱ ${timer.taskNumber != null ? `#${timer.taskNumber}` : timer.title} ${formatClock(Date.now() - timer.start)}`)
    if (settings.trackingPaused) parts.push(t.paused)
    else if (status.current) parts.push(`${status.current.displayName} · ${formatDuration(Date.now() - status.current.since, settings.language)}`)
    else if (status.state === 'idle' || status.state === 'locked') parts.push(t[status.state])
    tray.setToolTip(parts.join(' — ').slice(0, 127))
    tray.setImage(settings.trackingPaused ? images.paused : images.normal)
  }
  refresh()
  return { refresh }
}
