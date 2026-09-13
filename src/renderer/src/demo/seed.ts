import type { Service } from '@shared/service'
import type { ID, Lang, Priority, RecurrenceRule } from '@shared/types'
import { HOUR, MINUTE, addDays, startOfDayMs, todayKey, weekday } from '@shared/time'
import { DEFAULT_LABELS } from '@shared/catalog'

/** What the pretend tracker "sees" in the demo. */
export const DEMO_ACTIVITY = {
  exePath: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
  exeName: 'Code.exe',
  title: 'TodayPage.tsx — timehub — Visual Studio Code',
  displayName: 'Visual Studio Code'
}

type AppKey = 'code' | 'chrome' | 'telegram' | 'discord' | 'terminal' | 'figma' | 'obsidian' | 'spotify' | 'game' | 'word'

const APPS: Record<AppKey, { path: string; name: string; color: string; glyph: string }> = {
  code: { path: DEMO_ACTIVITY.exePath, name: 'Visual Studio Code', color: '#0078d4', glyph: '{ }' },
  chrome: { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome', color: '#1a73e8', glyph: 'G' },
  telegram: { path: 'C:\\Users\\demo\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe', name: 'Telegram Desktop', color: '#27a7e7', glyph: 'T' },
  discord: { path: 'C:\\Users\\demo\\AppData\\Local\\Discord\\app-1.0.9200\\Discord.exe', name: 'Discord', color: '#5865f2', glyph: 'D' },
  terminal: { path: 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe', name: 'Terminal', color: '#2b2b2b', glyph: '&gt;_' },
  figma: { path: 'C:\\Users\\demo\\AppData\\Local\\Figma\\Figma.exe', name: 'Figma', color: '#a259ff', glyph: 'F' },
  obsidian: { path: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Obsidian\\Obsidian.exe', name: 'Obsidian', color: '#7c3aed', glyph: 'O' },
  spotify: { path: 'C:\\Users\\demo\\AppData\\Roaming\\Spotify\\Spotify.exe', name: 'Spotify', color: '#1db954', glyph: 'S' },
  game: { path: 'D:\\SteamLibrary\\steamapps\\common\\Hades II\\Ship\\Hades2.exe', name: 'Hades II', color: '#b42318', glyph: 'H' },
  word: { path: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE', name: 'Microsoft Word', color: '#2b579a', glyph: 'W' }
}

const TITLES: Record<Lang, Record<AppKey | 'youtube', string[]>> = {
  en: {
    code: ['service.ts — timehub', 'TodayPage.tsx — timehub', 'tracker.ts — timehub', 'README.md — timehub', 'schedule.test.ts — timehub'],
    chrome: ['mistereshka/timehub · GitHub', 'Primer design system', 'Stack Overflow — React state', 'Gmail — Inbox', 'MDN Web Docs'],
    youtube: ['Lofi hip hop radio - YouTube', 'Fireship: 100 seconds of Rust - YouTube', 'Twitch — speedrun'],
    telegram: ['Telegram'],
    discord: ['#general — Friends', 'Voice — Gaming night'],
    terminal: ['npm run dev', 'PowerShell'],
    figma: ['timehub — UI kit'],
    obsidian: ['Journal — Obsidian', 'Reading notes — Obsidian'],
    spotify: ['Spotify Premium'],
    game: ['Hades II'],
    word: ['Thesis — chapter 2.docx']
  },
  ru: {
    code: ['service.ts — timehub', 'TodayPage.tsx — timehub', 'tracker.ts — timehub', 'README.md — timehub', 'schedule.test.ts — timehub'],
    chrome: ['mistereshka/timehub · GitHub', 'Primer design system', 'Stack Overflow на русском', 'Gmail — Входящие', 'Хабр'],
    youtube: ['Lofi hip hop radio - YouTube', 'Разбор алгоритмов - YouTube', 'Twitch — спидран'],
    telegram: ['Telegram'],
    discord: ['#общий — Друзья', 'Голосовой — игровой вечер'],
    terminal: ['npm run dev', 'PowerShell'],
    figma: ['timehub — UI kit'],
    obsidian: ['Дневник — Obsidian', 'Конспекты — Obsidian'],
    spotify: ['Spotify Premium'],
    game: ['Hades II'],
    word: ['Курсовая — глава 2.docx']
  }
}

interface Segment {
  app: AppKey
  min: number
  max: number
  w: number
  youtube?: boolean
}

const WORK_MIX: Segment[] = [
  { app: 'code', min: 15, max: 55, w: 5 },
  { app: 'chrome', min: 4, max: 20, w: 3 },
  { app: 'telegram', min: 1, max: 6, w: 2 },
  { app: 'terminal', min: 2, max: 10, w: 2 },
  { app: 'figma', min: 10, max: 30, w: 0.6 },
  { app: 'word', min: 15, max: 40, w: 0.5 },
  { app: 'obsidian', min: 5, max: 15, w: 0.7 }
]
const EVENING_MIX: Segment[] = [
  { app: 'game', min: 30, max: 90, w: 3 },
  { app: 'discord', min: 5, max: 25, w: 2 },
  { app: 'chrome', min: 10, max: 30, w: 2, youtube: true },
  { app: 'spotify', min: 2, max: 5, w: 0.5 },
  { app: 'telegram', min: 2, max: 8, w: 1 }
]
const WEEKEND_MIX: Segment[] = [
  { app: 'chrome', min: 10, max: 40, w: 3, youtube: true },
  { app: 'obsidian', min: 10, max: 30, w: 1.5 },
  { app: 'telegram', min: 2, max: 10, w: 2 },
  { app: 'discord', min: 5, max: 20, w: 1 },
  { app: 'spotify', min: 2, max: 6, w: 0.7 }
]

interface TaskSpec {
  title: Record<Lang, string>
  body?: Record<Lang, string>
  /** indexes into DEFAULT_LABELS */
  labels?: number[]
  project?: number
  created: number
  closed?: number
  planned?: number
  due?: number
  estimate?: number
  priority?: Priority
  /** [days ago, start hour, minutes] of timer work */
  work?: [number, number, number][]
  running?: boolean
}

const PROJECTS = [
  { name: { en: 'timehub', ru: 'timehub' }, color: '#1f883d', description: { en: 'This app', ru: 'Это приложение' } },
  { name: { en: 'Study', ru: 'Учёба' }, color: '#8250df', description: { en: 'University', ru: 'Университет' } },
  { name: { en: 'Home', ru: 'Дом' }, color: '#bf8700', description: { en: 'Chores and errands', ru: 'Быт и дела' } }
]

const TASKS: TaskSpec[] = [
  {
    title: { en: 'Track active windows like Discord', ru: 'Трекер активных окон как в Discord' },
    body: {
      en: 'Poll the foreground window every 5 s.\n\n- [x] Win32 bindings via koffi\n- [x] Idle detection\n- [x] Game detection',
      ru: 'Опрашивать активное окно раз в 5 секунд.\n\n- [x] Win32 через koffi\n- [x] Определение простоя\n- [x] Определение игр'
    },
    labels: [0], project: 0, created: 21, closed: 12, estimate: 240, priority: 3,
    work: [[20, 10, 95], [19, 14, 120], [15, 10, 70], [12, 15, 45]]
  },
  {
    title: { en: 'Contribution graph on the overview', ru: 'Contribution graph на главной' },
    labels: [0, 5], project: 0, created: 16, closed: 6, estimate: 180, work: [[9, 11, 80], [7, 14, 65], [6, 10, 40]]
  },
  { title: { en: 'Export to CSV and JSON', ru: 'Экспорт в CSV и JSON' }, labels: [0], project: 0, created: 11, closed: 3, estimate: 60, work: [[3, 11, 55]] },
  {
    title: { en: 'Weekly planner with drag & drop', ru: 'Недельный планировщик с drag & drop' },
    body: { en: 'Columns for each day, drag tasks between them.', ru: 'Колонки по дням недели, задачи перетаскиваются между днями.' },
    labels: [0], project: 0, created: 8, planned: 0, estimate: 180, priority: 2, work: [[2, 15, 50], [1, 10, 75]], running: true
  },
  { title: { en: 'Dark dimmed theme', ru: 'Тёмная тема dark dimmed' }, labels: [0], project: 0, created: 5, closed: 1, estimate: 45, work: [[1, 16, 35]] },
  { title: { en: 'Write a README with a GIF', ru: 'Написать README с гифкой' }, labels: [0], project: 0, created: 3, planned: 1, estimate: 60 },
  {
    title: { en: 'Fix: timer keeps running after closing a task', ru: 'Баг: таймер не останавливается при закрытии задачи' },
    labels: [4], project: 0, created: 7, closed: 7, priority: 3, work: [[7, 17, 25]]
  },
  { title: { en: 'Idea: sync with GitHub Issues', ru: 'Идея: синхронизация с GitHub Issues' }, labels: [5], project: 0, created: 2 },
  {
    title: { en: 'Prepare for the calculus exam', ru: 'Подготовиться к экзамену по матану' },
    body: {
      en: '- [x] Limits\n- [x] Derivatives\n- [ ] Integrals\n- [ ] Series\n\n> Exam is on Tuesday, room 404',
      ru: '- [x] Пределы\n- [x] Производные\n- [ ] Интегралы\n- [ ] Ряды\n\n> Экзамен во вторник, ауд. 404'
    },
    labels: [2, 4], project: 1, created: 14, planned: 0, due: 2, estimate: 300, priority: 3, work: [[4, 18, 90], [2, 19, 60], [0, 9, 45]]
  },
  {
    title: { en: 'Thesis: chapter 2', ru: 'Курсовая: глава 2' },
    labels: [2], project: 1, created: 25, planned: 2, due: 9, estimate: 480, priority: 2, work: [[10, 15, 110], [5, 16, 95]]
  },
  { title: { en: 'Read "Clean Architecture", ch. 5–7', ru: 'Прочитать «Чистую архитектуру», гл. 5–7' }, labels: [2], project: 1, created: 9, closed: 2, work: [[4, 21, 40], [2, 21, 50]] },
  { title: { en: 'Book a dentist appointment', ru: 'Записаться к стоматологу' }, labels: [3], project: 2, created: 6, due: -1, priority: 2 },
  { title: { en: 'Buy a birthday present for mom', ru: 'Купить подарок маме' }, labels: [1], project: 2, created: 4, planned: 3, due: 5, priority: 1 },
  { title: { en: 'Pay utilities', ru: 'Оплатить коммуналку' }, labels: [1], project: 2, created: 12, closed: 10 },
  { title: { en: 'Declutter the wardrobe', ru: 'Разобрать шкаф' }, labels: [1], project: 2, created: 30 },
  { title: { en: 'Plan the weekend trip', ru: 'Спланировать поездку на выходные' }, labels: [1], created: 1, planned: 4 }
]

interface RecurrenceSpec {
  title: Record<Lang, string>
  rule: RecurrenceRule
  daysMask?: number
  dayOfMonth?: number
  labels: number[]
  estimate?: number
  startAgo: number
  doneRate: number
  doneHour: number
  trackMin?: number
}

const RECURRENCES: RecurrenceSpec[] = [
  { title: { en: 'Morning workout, 15 min', ru: 'Зарядка 15 минут' }, rule: 'daily', labels: [3], estimate: 15, startAgo: 45, doneRate: 0.85, doneHour: 8 },
  { title: { en: 'English practice, 30 min', ru: 'Английский 30 минут' }, rule: 'weekdays', labels: [2], estimate: 30, startAgo: 35, doneRate: 0.8, doneHour: 19, trackMin: 30 },
  { title: { en: 'Inbox zero: mail and messages', ru: 'Разобрать почту и сообщения' }, rule: 'weekly', daysMask: 0b0001001, labels: [0], estimate: 20, startAgo: 40, doneRate: 0.9, doneHour: 10 },
  { title: { en: 'Pay the internet bill', ru: 'Оплатить интернет' }, rule: 'monthly', dayOfMonth: 10, labels: [1], startAgo: 100, doneRate: 1, doneHour: 12 }
]

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function iconDataUrl(color: string, glyph: string): string {
  const size = glyph.length > 1 ? 12 : 17
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/>` +
    `<text x="16" y="${glyph.length > 1 ? 20.5 : 22}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Fills a fresh demo database with four months of plausible history. `setNow`
 * moves the service clock so created/closed times and timers land in the past.
 */
export function seedDemo(service: Service, lang: Lang, setNow: (t: number | null) => void): void {
  const rand = mulberry32(20260913)
  const now = Date.now()
  const today = todayKey(now)
  const at = (daysAgo: number, hour: number): number => startOfDayMs(addDays(today, -daysAgo)) + hour * HOUR
  const pick = <T extends { w: number }>(list: T[]): T => {
    let r = rand() * list.reduce((s, x) => s + x.w, 0)
    for (const x of list) if ((r -= x.w) <= 0) return x
    return list[list.length - 1]
  }
  const labelId = new Map(service.listLabels().map((l) => [l.name, l.id]))
  const labelIds = (idx: number[] = []): ID[] => idx.map((i) => labelId.get(DEFAULT_LABELS[lang][i].name)!).filter(Boolean)

  // Apps with generated icons
  const appIds = {} as Record<AppKey, ID>
  for (const [key, a] of Object.entries(APPS) as [AppKey, (typeof APPS)[AppKey]][]) {
    setNow(at(120, 9))
    const { app } = service.ensureApp(a.path, a.path.split('\\').pop()!, a.name)
    service.setAppIcon(app.id, iconDataUrl(a.color, a.glyph))
    appIds[key] = app.id
  }

  // Activity history
  const titles = TITLES[lang]
  const fill = (from: number, to: number, mix: Segment[]): void => {
    let t = from
    let prev: AppKey | null = null
    while (t < to - 2 * MINUTE && t < now) {
      let seg = pick(mix)
      if (seg.app === prev) seg = pick(mix)
      const end = Math.min(to, now, t + Math.round((seg.min + rand() * (seg.max - seg.min)) * MINUTE))
      const pool = seg.youtube ? titles.youtube : titles[seg.app]
      service.seedSession(appIds[seg.app], pool[Math.floor(rand() * pool.length)], t, end)
      prev = seg.app
      t = end + (rand() < 0.15 ? Math.round(rand() * 8 * MINUTE) : 0)
    }
  }
  for (let d = 119; d >= 0; d--) {
    if (d > 0 && rand() < 0.08) continue
    const key = addDays(today, -d)
    const day = startOfDayMs(key)
    const j = (min: number): number => Math.round(rand() * min * MINUTE)
    if (weekday(key) < 5) {
      fill(day + 9 * HOUR + j(50), day + 12.5 * HOUR + j(20), WORK_MIX)
      fill(day + 13.5 * HOUR + j(20), day + 17.5 * HOUR + j(90), WORK_MIX)
      if (rand() < 0.55) fill(day + 20 * HOUR + j(60), day + 22.5 * HOUR + j(60), EVENING_MIX)
    } else {
      if (rand() < 0.8) fill(day + 11 * HOUR + j(60), day + 14 * HOUR, WEEKEND_MIX)
      if (rand() < 0.75) fill(day + 16 * HOUR + j(120), day + 21 * HOUR + j(120), EVENING_MIX)
    }
  }

  // Projects and tasks
  setNow(at(40, 9))
  const projectIds = PROJECTS.map((p) => service.saveProject({ name: p.name[lang], color: p.color, description: p.description[lang] }).id)
  const specs = [...TASKS].sort((a, b) => b.created - a.created)
  let runningTask: ID | null = null
  for (const spec of specs) {
    setNow(at(spec.created, 10) + Math.round(rand() * 6 * HOUR))
    const task = service.createTask({
      title: spec.title[lang],
      body: spec.body?.[lang] ?? '',
      labelIds: labelIds(spec.labels),
      projectId: spec.project != null ? projectIds[spec.project] : null,
      plannedDate: spec.planned != null ? addDays(today, spec.planned) : null,
      dueDate: spec.due != null ? addDays(today, spec.due) : null,
      estimateMin: spec.estimate ?? null,
      priority: spec.priority ?? 0
    })
    for (const [daysAgo, hour, minutes] of spec.work ?? []) {
      const start = at(daysAgo, hour)
      if (start + minutes * MINUTE > now) continue
      setNow(start)
      service.startTimer(task.id)
      setNow(start + minutes * MINUTE)
      service.stopTimer()
    }
    if (spec.closed != null) {
      setNow(Math.min(now, at(spec.closed, 17) + Math.round(rand() * 3 * HOUR)))
      service.updateTask(task.id, { status: 'closed' })
    }
    if (spec.running) runningTask = task.id
  }

  // Recurring tasks with history
  const maxStart = Math.max(...RECURRENCES.map((r) => r.startAgo))
  const recIds = new Map<ID, RecurrenceSpec>()
  for (let d = maxStart; d >= 0; d--) {
    const key = addDays(today, -d)
    setNow(at(d, 7))
    for (const spec of RECURRENCES) {
      if (spec.startAgo === d) {
        const rec = service.saveRecurrence({
          title: spec.title[lang], rule: spec.rule, daysMask: spec.daysMask, dayOfMonth: spec.dayOfMonth ?? null,
          labelIds: labelIds(spec.labels), estimateMin: spec.estimate ?? null, startDate: key
        })
        recIds.set(rec.id, spec)
      }
    }
    service.generateRecurring(key)
    for (const task of service.listTasks({ status: 'open' })) {
      const spec = task.recurrenceId != null ? recIds.get(task.recurrenceId) : undefined
      if (!spec || task.plannedDate !== key) continue
      const doneAt = at(d, spec.doneHour) + Math.round(rand() * 40 * MINUTE)
      if (doneAt > now) continue
      if (d <= 7 || rand() < spec.doneRate) {
        if (spec.trackMin) {
          setNow(doneAt - spec.trackMin * MINUTE)
          service.startTimer(task.id)
        }
        setNow(doneAt)
        service.updateTask(task.id, { status: 'closed' })
      } else {
        service.deleteTask(task.id)
      }
    }
  }

  // Rules
  setNow(at(30, 9))
  const media = service.listCategories().find((c) => c.key === 'media')
  if (media) service.saveRule({ appId: appIds.chrome, titlePattern: '/youtube|twitch/', taskId: null, categoryId: media.id })
  const planner = service.listTasks().find((t) => t.title === TASKS[3].title[lang])
  if (planner) service.saveRule({ appId: appIds.code, titlePattern: 'timehub', taskId: planner.id, categoryId: null })
  service.reapplyRules(0)

  if (runningTask != null) {
    setNow(now - 38 * MINUTE)
    service.startTimer(runningTask)
  }
  setNow(null)
}
