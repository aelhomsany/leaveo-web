/**
 * Plan MEDIA (half-day leave) — en/ar parity for the keys the feature added, named here so a gap in
 * any of them fails a test that says which. `verify:i18n` checks every namespace wholesale; this
 * pins these subtrees and keys explicitly. `defaultValue` cannot cover for a missing key in this app
 * (parseMissingKeyHandler returns ''), so a gap would render blank rather than in English.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import i18n from './config'

type Locale = 'en' | 'ar'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function flatten(value: unknown, prefix = ''): [string, unknown][] {
  if (value === null || typeof value !== 'object') return prefix ? [[prefix, value]] : []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

function localeEntries(locale: Locale, namespace: string): Map<string, unknown> {
  const path = resolve(webRoot, `src/i18n/locales/${locale}/${namespace}.json`)
  return new Map(flatten(JSON.parse(readFileSync(path, 'utf8'))))
}

function keysUnder(entries: Map<string, unknown>, subtree: string): string[] {
  return [...entries.keys()].filter((key) => key.startsWith(`${subtree}.`)).sort()
}

function interpolationTokens(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return [...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]).sort()
}

// Whole subtrees the row names: every key under each must exist in both locales.
const subtrees: [namespace: string, subtree: string][] = [
  ['common', 'dayParts'],
  ['dashboard', 'request.dayParts'],
  ['dashboard', 'request.errors'],
]

// Every key MEDIA added, by name, so dropping one from both files together still fails.
const mediaKeys: Record<string, string[]> = {
  common: ['dayParts.FIRST_HALF', 'dayParts.FULL', 'dayParts.SECOND_HALF', 'dayParts.halfDay'],
  dashboard: [
    'request.dayParts.startFull',
    'request.dayParts.startSecondHalf',
    'request.dayParts.endFull',
    'request.dayParts.endFirstHalf',
    'request.fields.dayPart',
    'request.fields.startPart',
    'request.fields.endPart',
    'request.errors.halfDayNotAllowed',
    'request.errors.halfDayOnNonWorkingDay',
    'request.errors.contradictoryParts',
    'request.errors.overlaps',
  ],
  settings: ['leaveTypes.fields.halfDayAllowed', 'leaveTypes.halfDayHint', 'leaveTypes.wholeDaysOnly'],
}

describe('Plan MEDIA locale parity', () => {
  // MEDIA-UI-VAL-008. en and ar carry the same keys under common:dayParts, dashboard:request.dayParts
  // and dashboard:request.errors.
  it.each(subtrees)('[P0] en and ar have identical keys under %s:%s', (namespace, subtree) => {
    const en = keysUnder(localeEntries('en', namespace), subtree)
    const ar = keysUnder(localeEntries('ar', namespace), subtree)

    expect(en.length).toBeGreaterThan(0)
    expect(ar, `ar/${namespace}.json drifted from en under ${subtree}`).toEqual(en)
  })

  // MEDIA-UI-VAL-008. Every key MEDIA added exists in both locale files and in the app's i18n
  // bundles, with a non-empty English and Arabic value, an Arabic value that is not the English one
  // copied over, and the same interpolation tokens.
  it.each(Object.entries(mediaKeys))('[P0] every Plan MEDIA key in %s is present and filled in both locales', (namespace, keys) => {
    const en = localeEntries('en', namespace)
    const ar = localeEntries('ar', namespace)

    for (const key of keys) {
      const id = `${namespace}:${key}`
      const enValue = en.get(key)
      const arValue = ar.get(key)
      expect(typeof enValue, `${id} missing in en`).toBe('string')
      expect(typeof arValue, `${id} missing in ar`).toBe('string')
      expect(String(enValue).trim(), `${id} is empty in en`).not.toBe('')
      expect(String(arValue).trim(), `${id} is empty in ar`).not.toBe('')
      expect(arValue, `${id} is untranslated in ar`).not.toBe(enValue)
      expect(interpolationTokens(arValue), `${id} interpolation tokens`).toEqual(
        interpolationTokens(enValue),
      )
      // getResource reads each language's own bundle; exists() would fall back to en for ar.
      expect(i18n.getResource('en', namespace, key), `${id} not bundled for en`).toBe(enValue)
      expect(i18n.getResource('ar', namespace, key), `${id} not bundled for ar`).toBe(arValue)
    }
  })

  // MEDIA-UI-VAL-008. Nothing under the named subtrees is blank in either locale, and Arabic keeps
  // English's interpolation tokens -- except that an Arabic one/two plural may spell the count out.
  it.each(subtrees)('[P0] no value under %s:%s is empty, and tokens match', (namespace, subtree) => {
    const en = localeEntries('en', namespace)
    const ar = localeEntries('ar', namespace)

    for (const key of keysUnder(en, subtree)) {
      const id = `${namespace}:${key}`
      expect(String(en.get(key) ?? '').trim(), `${id} is empty in en`).not.toBe('')
      expect(String(ar.get(key) ?? '').trim(), `${id} is empty in ar`).not.toBe('')
      const enTokens = interpolationTokens(en.get(key))
      const arTokens = interpolationTokens(ar.get(key))
      if (/_(?:one|two)$/.test(key)) {
        expect(arTokens.every((token) => enTokens.includes(token)), `${id} interpolation tokens`).toBe(true)
      } else {
        expect(arTokens, `${id} interpolation tokens`).toEqual(enTokens)
      }
    }
  })
})
