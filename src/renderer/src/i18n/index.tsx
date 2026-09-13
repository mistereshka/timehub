import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { format, formatDistanceToNowStrict, type Locale } from 'date-fns'
import { enUS, ru as ruLocale } from 'date-fns/locale'
import type { Lang } from '@shared/types'
import { MINUTE, formatDuration, parseDayKey } from '@shared/time'
import { en, type MessageKey } from './en'
import { ru } from './ru'

export type { MessageKey }
type Vars = Record<string, string | number>

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { en, ru }
const LOCALES: Record<Lang, Locale> = { en: enUS, ru: ruLocale }

export interface I18n {
  lang: Lang
  locale: Locale
  t(key: MessageKey, vars?: Vars): string
  /** Plural forms separated by "|" — en: one|other, ru: one|few|many. `{n}` is the count. */
  tn(key: MessageKey, n: number, vars?: Vars): string
  duration(ms: number, withSeconds?: boolean): string
  /** Formats a timestamp, Date or yyyy-mm-dd key with a date-fns pattern. */
  date(value: number | Date | string, pattern?: string): string
  /** "3 days ago" */
  ago(ts: number): string
}

const interpolate = (s: string, vars?: Vars): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s

function createI18n(lang: Lang): I18n {
  const dict = DICTIONARIES[lang]
  const locale = LOCALES[lang]
  const plural = new Intl.PluralRules(lang)
  const t = (key: MessageKey, vars?: Vars): string => interpolate(dict[key] ?? en[key] ?? key, vars)
  return {
    lang,
    locale,
    t,
    tn: (key, n, vars) => {
      const forms = (dict[key] ?? en[key]).split('|')
      const category = plural.select(n)
      const index = lang === 'ru' ? ({ one: 0, few: 1 } as Record<string, number>)[category] ?? 2 : category === 'one' ? 0 : 1
      return interpolate(forms[Math.min(index, forms.length - 1)], { n: n.toLocaleString(lang), ...vars })
    },
    duration: (ms, withSeconds) => formatDuration(ms, lang, withSeconds),
    date: (value, pattern = 'd MMM yyyy') => format(typeof value === 'string' ? parseDayKey(value) : value, pattern, { locale }),
    ago: (ts) => (Date.now() - ts < MINUTE ? t('time.justNow') : formatDistanceToNowStrict(ts, { addSuffix: true, locale }))
  }
}

const I18nContext = createContext<I18n>(createI18n('en'))

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }): ReactNode {
  const value = useMemo(() => createI18n(lang), [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = (): I18n => useContext(I18nContext)
