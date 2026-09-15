import type { Service } from '@shared/service'
import type { CalendarEvent, DayValue, ID, LibraryImport, LibraryInput, Lang, Priority, RecurrenceRule } from '@shared/types'
import { DAY, HOUR, MINUTE, addDays, startOfDayMs, todayKey, weekday } from '@shared/time'
import { DEFAULT_LABELS } from '@shared/catalog'

/** What the pretend tracker "sees" in the demo. */
export const DEMO_ACTIVITY = {
  exePath: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
  exeName: 'Code.exe',
  title: 'TodayPage.tsx — timehub — Visual Studio Code',
  displayName: 'Visual Studio Code'
}

export const DEMO_GAME = {
  name: 'Hades II',
  steamId: '1145350',
  header: 'https://cdn.akamai.steamstatic.com/steam/apps/1145350/header.jpg',
  cover: 'https://cdn.akamai.steamstatic.com/steam/apps/1145350/library_600x900.jpg',
  store: 'https://store.steampowered.com/app/1145350/'
}

export const DEMO_CALENDAR = 'demo-work'

export const DEMO_TRACKS = [
  { title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories', sec: 369, hue: 40 },
  { title: 'Weird Fishes/Arpeggi', artist: 'Radiohead', album: 'In Rainbows', sec: 318, hue: 200 },
  { title: 'Группа крови', artist: 'Кино', album: 'Группа крови', sec: 286, hue: 0 },
  { title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We’re Dreaming', sec: 244, hue: 280 },
  { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', sec: 200, hue: 350 },
  { title: 'Nights', artist: 'Frank Ocean', album: 'Blonde', sec: 307, hue: 120 },
  { title: 'Time', artist: 'Hans Zimmer', album: 'Inception', sec: 275, hue: 220 },
  { title: 'Спокойная ночь', artist: 'Кино', album: 'Группа крови', sec: 363, hue: 20 },
  { title: 'Kids', artist: 'MGMT', album: 'Oracular Spectacular', sec: 302, hue: 170 },
  { title: 'Redbone', artist: 'Childish Gambino', album: 'Awaken, My Love!', sec: 327, hue: 300 }
]

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
    telegram: ['Mom – (demo)', 'timehub team – (demo)', 'Telegram'],
    discord: ['@alex - Discord', '#general | Friends - Discord', '#voice | Friends - Discord'],
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
    telegram: ['Мама – (demo)', 'Команда timehub – (demo)', 'Telegram'],
    discord: ['@alex - Discord', '#общий | Друзья - Discord', '#голосовой | Друзья - Discord'],
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

type Text = Record<Lang, string>

interface GoalSpec {
  title: Text
  body: Text
  emoji: string
  color: string
  auto?: boolean
  progress?: number
  targetIn?: number
  /** days ago it was achieved */
  achieved?: number
  /** [days ago, note, progress] */
  notes: [number, Text, number | null][]
}

const GOALS: GoalSpec[] = [
  {
    title: { en: 'English to B2', ru: 'Английский до B2' },
    body: {
      en: 'Speak freely at work and watch series without subtitles.\n\n- Tue and Fri — 2 hours of study\n- A speaking club once a month',
      ru: 'Свободно говорить на созвонах и смотреть сериалы без субтитров.\n\n- Вторник и пятница — по 2 часа занятий\n- Раз в месяц — разговорный клуб'
    },
    emoji: '🗣️', color: '#0969da', progress: 40, targetIn: 110,
    notes: [
      [60, { en: 'Started English File Intermediate.', ru: 'Начал заниматься по English File Intermediate.' }, 20],
      [30, { en: 'Five units done; watching series with English subtitles now.', ru: 'Прошёл 5 юнитов, смотрю сериалы с английскими субтитрами.' }, 30],
      [6, { en: 'First speaking club — scary, but I understood almost everything 🎉', ru: 'Первый разговорный клуб — было страшно, но понял почти всё 🎉' }, 40]
    ]
  },
  {
    title: { en: 'Ship timehub 1.0', ru: 'Выпустить timehub 1.0' },
    body: { en: 'Tracker, planning and reports good enough for daily use.', ru: 'Трекер, планирование и отчёты — чтобы пользоваться каждый день.' },
    emoji: '🚀', color: '#1f883d', auto: true, targetIn: 30,
    notes: [[4, { en: 'Goals and the library are working. Next: installer.', ru: 'Цели и библиотека работают. Дальше — установщик.' }, null]]
  },
  {
    title: { en: 'Run a half marathon', ru: 'Пробежать полумарафон' },
    body: { en: '21.1 km in under 2 hours.', ru: '21,1 км быстрее двух часов.' },
    emoji: '🏃', color: '#bf3989', progress: 25, targetIn: 60,
    notes: [
      [38, { en: 'First 5 km run, 6:30 pace.', ru: 'Первая пробежка на 5 км, темп 6:30.' }, 10],
      [12, { en: '12 km without stopping!', ru: 'Пробежал 12 км без остановок!' }, 25]
    ]
  },
  {
    title: { en: 'Read 12 books this year', ru: 'Прочитать 12 книг за год' },
    body: { en: 'One book a month.', ru: 'По книге в месяц.' },
    emoji: '📚', color: '#bf8700', progress: 100, achieved: 3,
    notes: [[3, { en: 'Book number twelve is done 📚', ru: 'Двенадцатая книга прочитана 📚' }, 100]]
  }
]
const GOAL_ENGLISH = 0
const GOAL_TIMEHUB = 1
const GOAL_RUN = 2

interface TaskSpec {
  title: Text
  body?: Text
  /** indexes into DEFAULT_LABELS */
  labels?: number[]
  project?: number
  created: number
  closed?: number
  planned?: number
  time?: string
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
    labels: [0], project: 0, created: 8, planned: 0, time: '11:00', estimate: 180, priority: 2, work: [[2, 15, 50], [1, 10, 75]], running: true
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
    labels: [2, 4], project: 1, created: 14, planned: 0, time: '15:00', due: 2, estimate: 300, priority: 3,
    work: [[4, 18, 90], [2, 19, 60], [0, 9, 45]]
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
const PLANNER_TASK = 3
const SUBTASKS: [Text, number | null][] = [
  [{ en: 'Columns for each day', ru: 'Колонки по дням' }, 2],
  [{ en: 'Drag tasks between days', ru: 'Перетаскивание между днями' }, 1],
  [{ en: 'Dashed cards for recurring tasks', ru: 'Пунктирные карточки для повторов' }, null]
]

interface RecurrenceSpec {
  title: Text
  rule: RecurrenceRule
  daysMask?: number
  dayOfMonth?: number
  time?: string
  completeOnTarget?: boolean
  goal?: number
  labels: number[]
  estimate?: number
  startAgo: number
  doneRate: number
  doneHour: number
  trackMin?: number
}

/** Bit n = weekday n, Monday first. */
const days = (...list: number[]): number => list.reduce((m, d) => m | (1 << d), 0)

const RECURRENCES: RecurrenceSpec[] = [
  { title: { en: 'Morning workout, 15 min', ru: 'Зарядка 15 минут' }, rule: 'daily', labels: [3], estimate: 15, startAgo: 45, doneRate: 0.85, doneHour: 8 },
  {
    title: { en: 'English study', ru: 'Изучение английского' }, rule: 'weekly', daysMask: days(1, 4), time: '19:00', completeOnTarget: true,
    goal: GOAL_ENGLISH, labels: [2], estimate: 120, startAgo: 70, doneRate: 0.85, doneHour: 21, trackMin: 120
  },
  { title: { en: 'Inbox zero: mail and messages', ru: 'Разобрать почту и сообщения' }, rule: 'weekly', daysMask: days(0, 3), labels: [0], estimate: 20, startAgo: 40, doneRate: 0.9, doneHour: 10 },
  { title: { en: 'Pay the internet bill', ru: 'Оплатить интернет' }, rule: 'monthly', dayOfMonth: 10, labels: [1], startAgo: 100, doneRate: 1, doneHour: 12 }
]

type AnimeRow = [en: string, ru: string, original: string, status: LibraryImport['status'], progress: number, total: number | null, extra?: Partial<LibraryImport>]
const ANIME: AnimeRow[] = [
  ['Frieren: Beyond Journey’s End', 'Провожающая в последний путь Фрирен', 'Sousou no Frieren', 'active', 18, 28, { rating: 10, year: 2023 }],
  ['Spy x Family', 'Семья шпиона', 'Spy x Family', 'active', 30, 37, { year: 2022 }],
  ['Dandadan', 'Дандадан', 'Dandadan', 'active', 16, 24, { latest: 18, year: 2024 }],
  ['Solo Leveling', 'Поднятие уровня в одиночку', 'Ore dake Level Up na Ken', 'active', 20, 25, { year: 2024 }],
  ['Jujutsu Kaisen', 'Магическая битва', 'Jujutsu Kaisen', 'active', 41, 47, { rating: 8, year: 2020 }],
  ['The Apothecary Diaries', 'Монолог фармацевта', 'Kusuriya no Hitorigoto', 'active', 30, 48, { year: 2023 }],
  ['Oshi no Ko', 'Звёздное дитя', 'Oshi no Ko', 'planned', 0, 24, { year: 2023 }],
  ['Blue Lock', 'Синяя тюрьма: Блю Лок', 'Blue Lock', 'planned', 0, 38, { year: 2022 }],
  ['Mushishi', 'Мастер Муси', 'Mushishi', 'planned', 0, 26, { year: 2005 }],
  ['Chainsaw Man', 'Человек-бензопила', 'Chainsaw Man', 'completed', 12, 12, { rating: 9, favorite: true, year: 2022 }],
  ['Vinland Saga', 'Сага о Винланде', 'Vinland Saga', 'completed', 48, 48, { rating: 9, year: 2019 }],
  ['Cyberpunk: Edgerunners', 'Киберпанк: Бегущие по краю', 'Cyberpunk: Edgerunners', 'completed', 10, 10, { rating: 10, favorite: true, year: 2022 }],
  ['Mob Psycho 100', 'Моб Психо 100', 'Mob Psycho 100', 'completed', 37, 37, { rating: 8, year: 2016 }],
  ['Attack on Titan', 'Атака титанов', 'Shingeki no Kyojin', 'completed', 94, 94, { rating: 10, favorite: true, year: 2013 }],
  ['Death Note', 'Тетрадь смерти', 'Death Note', 'completed', 37, 37, { rating: 9, favorite: true, year: 2006 }],
  ['Steins;Gate', 'Врата Штейна', 'Steins;Gate', 'completed', 24, 24, { rating: 10, favorite: true, year: 2011 }],
  ['Violet Evergarden', 'Вайолет Эвергарден', 'Violet Evergarden', 'completed', 13, 13, { rating: 9, year: 2018 }],
  ['Made in Abyss', 'Созданный в Бездне', 'Made in Abyss', 'completed', 25, 25, { rating: 8, year: 2017 }],
  ['Your Lie in April', 'Твоя апрельская ложь', 'Shigatsu wa Kimi no Uso', 'completed', 22, 22, { rating: 9, year: 2014 }],
  ['Kaiju No. 8', 'Кайдзю номер восемь', 'Kaijuu 8-gou', 'on_hold', 5, 23, { year: 2024 }]
]

type ItemRow = [en: string, ru: string, input: Omit<LibraryInput, 'title'>]
const LIBRARY: ItemRow[] = [
  ['Dune', 'Дюна', { kind: 'book', status: 'active', progress: 320, total: 704, year: 1965, originalTitle: 'Dune' }],
  ['Clean Architecture', 'Чистая архитектура', { kind: 'book', status: 'active', progress: 140, total: 352, year: 2017, originalTitle: 'Clean Architecture' }],
  ['1984', '1984', { kind: 'book', status: 'completed', progress: 328, total: 328, rating: 9, year: 1949 }],
  ['Interstellar', 'Интерстеллар', { kind: 'movie', status: 'completed', progress: 1, total: 1, rating: 10, favorite: true, year: 2014, originalTitle: 'Interstellar' }],
  ['Dune: Part Two', 'Дюна: Часть вторая', { kind: 'movie', status: 'planned', total: 1, year: 2024, originalTitle: 'Dune: Part Two' }],
  ['Arcane', 'Аркейн', { kind: 'series', status: 'completed', progress: 18, total: 18, rating: 10, year: 2021, originalTitle: 'Arcane' }],
  ['The Last of Us', 'Одни из нас', { kind: 'series', status: 'active', progress: 4, total: 16, year: 2023, originalTitle: 'The Last of Us' }],
  ['Hollow Knight', 'Hollow Knight', { kind: 'game', status: 'completed', rating: 9, year: 2017 }]
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

const escapeXml = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** Generated square "album art" for the pretend music player. */
export function artDataUrl(title: string, hue: number): string {
  const letters = escapeXml(
    title
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
  )
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},65%,28%)"/></linearGradient></defs>` +
    `<rect width="64" height="64" fill="url(#g)"/><text x="32" y="41" font-family="Segoe UI,Arial,sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#fff">${letters}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Fills a fresh demo database with four months of plausible history. `setNow`
 * moves the service clock so created/closed times and timers land in the past.
 */
export function seedDemo(service: Service, lang: Lang, setNow: (t: number | null) => void): { gameAppId: ID } {
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
  service.setAppLink({
    appId: appIds.game, provider: 'steam', externalId: DEMO_GAME.steamId, name: DEMO_GAME.name, imageUrl: DEMO_GAME.header, storeUrl: DEMO_GAME.store
  })

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

  // Calls (Windows notes when a messenger holds the microphone)
  for (let d = 20; d >= 1; d--) {
    if (rand() < 0.45) {
      const start = at(d, 21) + Math.round(rand() * 60 * MINUTE)
      service.upsertCall({ exePath: APPS.discord.path, app: 'Discord', start, end: start + Math.round((20 + rand() * 90) * MINUTE) })
    }
    if (rand() < 0.3) {
      const start = at(d, 13.5) + Math.round(rand() * 30 * MINUTE)
      service.upsertCall({ exePath: APPS.telegram.path, app: 'Telegram', start, end: start + Math.round((3 + rand() * 20) * MINUTE) })
    }
  }

  // Music history (Windows media sessions)
  for (let d = 29; d >= 0; d--) {
    for (const [hour, chance] of [[14, 0.5], [20.5, 0.8]] as const) {
      if (rand() > chance) continue
      let t = at(d, hour) + Math.round(rand() * 40 * MINUTE)
      const count = 5 + Math.floor(rand() * 10)
      for (let i = 0; i < count; i++) {
        const tr = DEMO_TRACKS[Math.floor(rand() * DEMO_TRACKS.length)]
        const end = t + tr.sec * 1000
        if (end > now) break
        service.seedMedia(rand() < 0.85 ? 'Spotify.exe' : 'chrome.exe', tr.title, tr.artist, tr.album, t, end)
        t = end + (rand() < 0.2 ? Math.round(rand() * 5 * MINUTE) : 0)
      }
    }
  }

  // Goals
  setNow(at(90, 9))
  const goalIds = GOALS.map(
    (g) =>
      service.saveGoal({
        title: g.title[lang], body: g.body[lang], emoji: g.emoji, color: g.color, autoProgress: g.auto ?? false,
        manualProgress: 0, targetDate: g.targetIn != null ? addDays(today, g.targetIn) : null
      }).id
  )

  // Projects and tasks
  setNow(at(40, 9))
  const projectIds = PROJECTS.map((p) => service.saveProject({ name: p.name[lang], color: p.color, description: p.description[lang] }).id)
  const specs = [...TASKS].sort((a, b) => b.created - a.created)
  let runningTask: ID | null = null
  const taskIds = new Map<TaskSpec, ID>()
  for (const spec of specs) {
    setNow(at(spec.created, 10) + Math.round(rand() * 6 * HOUR))
    const task = service.createTask({
      title: spec.title[lang],
      body: spec.body?.[lang] ?? '',
      labelIds: labelIds(spec.labels),
      projectId: spec.project != null ? projectIds[spec.project] : null,
      goalId: spec.project === 0 ? goalIds[GOAL_TIMEHUB] : null,
      plannedDate: spec.planned != null ? addDays(today, spec.planned) : null,
      plannedTime: spec.time ?? null,
      dueDate: spec.due != null ? addDays(today, spec.due) : null,
      estimateMin: spec.estimate ?? null,
      priority: spec.priority ?? 0
    })
    taskIds.set(spec, task.id)
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

  // Subtasks of the planner task
  const plannerId = taskIds.get(TASKS[PLANNER_TASK])!
  for (const [title, closedAgo] of SUBTASKS) {
    setNow(at(8, 11) + Math.round(rand() * HOUR))
    const sub = service.createTask({ title: title[lang], parentId: plannerId })
    if (closedAgo != null) {
      setNow(Math.min(now, at(closedAgo, 17)))
      service.updateTask(sub.id, { status: 'closed' })
    }
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
          timeOfDay: spec.time ?? null, completeOnTarget: spec.completeOnTarget ?? false,
          goalId: spec.goal != null ? goalIds[spec.goal] : null,
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

  // Time on the running goal itself: morning runs
  for (let d = 40; d >= 1; d--) {
    if (![0, 2, 5].includes(weekday(addDays(today, -d)))) continue
    setNow(at(d, 7) + Math.round(rand() * 20 * MINUTE))
    service.startGoalTimer(goalIds[GOAL_RUN])
    setNow(at(d, 7.6) + Math.round(rand() * 25 * MINUTE))
    service.stopTimer()
  }

  // Goal journals, manual progress and achievements
  GOALS.forEach((g, i) => {
    for (const [ago, body, progress] of g.notes) {
      setNow(at(ago, 21) + Math.round(rand() * HOUR))
      service.addGoalNote(goalIds[i], body[lang], progress)
    }
    if (!g.auto && g.progress != null) service.saveGoal({ id: goalIds[i], title: g.title[lang], manualProgress: g.progress })
    if (g.achieved != null) {
      setNow(at(g.achieved, 21.5))
      service.saveGoal({ id: goalIds[i], title: g.title[lang], status: 'achieved' })
    }
  })

  // Library: lists "imported" from AniLib/MangaLib and Steam, the rest by hand
  setNow(at(1, 20))
  service.importLibrary(
    'anilib',
    ANIME.map(([en, ru, original, status, progress, total, extra], i) => ({
      kind: 'anime', externalId: `demo-${i}`, title: lang === 'ru' ? ru : en, originalTitle: original, status, progress, total, format: 'TV', ...extra
    }))
  )
  service.importLibrary('mangalib', [
    { kind: 'manga', externalId: 'demo-berserk', title: lang === 'ru' ? 'Берсерк' : 'Berserk', originalTitle: 'Berserk', status: 'active', progress: 180, year: 1989, format: 'Manga' },
    { kind: 'manga', externalId: 'demo-vagabond', title: lang === 'ru' ? 'Бродяга' : 'Vagabond', originalTitle: 'Vagabond', status: 'planned', progress: 0, year: 1998, format: 'Manga' }
  ])
  service.importLibrary('steam', [
    { kind: 'game', externalId: DEMO_GAME.steamId, title: DEMO_GAME.name, coverUrl: DEMO_GAME.cover, status: 'active', year: 2025, format: 'Steam', url: DEMO_GAME.store, appId: appIds.game }
  ])
  LIBRARY.forEach(([en, ru, input], i) => {
    setNow(at(3 + i * 4, 20))
    service.saveLibraryItem({ ...input, title: lang === 'ru' ? ru : en })
  })

  // A work calendar around this week
  const ru = lang === 'ru'
  const events: Omit<CalendarEvent, 'id' | 'source'>[] = []
  const event = (key: string, uid: string, title: string, fromH: number, toH: number, color: string, location = ''): void => {
    const day = startOfDayMs(key)
    events.push({ uid: `${uid}-${key}`, title, location, start: day + fromH * HOUR, end: day + toH * HOUR, allDay: false, color })
  }
  for (let d = -7; d <= 14; d++) {
    const key = addDays(today, d)
    const wd = weekday(key)
    if (wd < 5) event(key, 'standup', ru ? 'Планёрка' : 'Daily standup', 10, 10.25, '#0969da', 'Google Meet')
    if (wd === 1 || wd === 3) event(key, 'lecture', ru ? 'Лекция: матанализ' : 'Lecture: calculus', 12, 13.5, '#8250df', ru ? 'ауд. 404' : 'Room 404')
    if (wd === 4) event(key, 'sync', ru ? 'Созвон с командой' : 'Team sync', 16, 17, '#0969da')
    if (wd === 6) event(key, 'parents', ru ? 'Созвон с родителями' : 'Call with parents', 18, 19, '#bf3989')
  }
  const birthday = startOfDayMs(addDays(today, 5))
  events.push({ uid: 'birthday', title: ru ? 'День рождения мамы 🎂' : 'Mom’s birthday 🎂', location: '', start: birthday, end: birthday + DAY, allDay: true, color: '#bf3989' })
  service.replaceCalendarEvents(DEMO_CALENDAR, startOfDayMs(addDays(today, -7)), startOfDayMs(addDays(today, 15)), events)

  // GitHub contributions for the overview heatmap
  const github: DayValue[] = []
  for (let d = 0; d < 365; d++) {
    const key = addDays(today, -d)
    const weekend = weekday(key) >= 5
    const active = rand() < (weekend ? 0.35 : 0.8)
    github.push({ date: key, value: active ? 1 + Math.floor(rand() * (weekend ? 4 : 9)) : 0 })
  }
  service.setExternalDays('github', github)

  // Rules
  setNow(at(30, 9))
  const media = service.listCategories().find((c) => c.key === 'media')
  if (media) service.saveRule({ appId: appIds.chrome, titlePattern: '/youtube|twitch/', taskId: null, categoryId: media.id })
  service.saveRule({ appId: appIds.code, titlePattern: 'timehub', taskId: plannerId, categoryId: null })
  service.reapplyRules(0)

  if (runningTask != null) {
    setNow(now - 38 * MINUTE)
    service.startTimer(runningTask)
  }
  setNow(null)
  return { gameAppId: appIds.game }
}
