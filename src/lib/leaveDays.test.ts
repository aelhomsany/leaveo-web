import i18n from '../i18n/config'
import { formatLeaveDays } from './leaveDays'

/**
 * Plan MEDIA: every day count that reaches the client is already in days, and a half day makes it
 * fractional. formatLeaveDays is the one place that decides how such a count is written for the
 * places that render a bare number rather than going through a plural key.
 */
describe('formatLeaveDays — Plan MEDIA', () => {
  // MEDIA-UI-VAL-005. A fractional count keeps exactly one decimal: 2.5, never 2.50.
  it.each([
    [2.5, '2.5'],
    [0.5, '0.5'],
    [10.5, '10.5'],
  ])('[P0] writes %s as "%s"', (days, text) => {
    expect(formatLeaveDays(days)).toBe(text)
  })

  // MEDIA-UI-VAL-005. A whole count has no decimal tail: 3, never 3.0.
  it.each([
    [3, '3'],
    [1, '1'],
    [0, '0'],
    [20, '20'],
  ])('[P0] writes %s as "%s"', (days, text) => {
    expect(formatLeaveDays(days)).toBe(text)
  })

  // MEDIA-UI-VAL-005. Signed counts are real -- a balance correction can take days away -- and
  // follow the same rules. Negative zero is still just zero.
  it.each([
    [-0.5, '-0.5'],
    [-2.5, '-2.5'],
    [-2, '-2'],
    [-0, '0'],
  ])('[P1] writes the signed count %s as "%s"', (days, text) => {
    expect(formatLeaveDays(days)).toBe(text)
  })

  // MEDIA-UI-VAL-005. No count is an empty string, not "0", "NaN", "null" or "undefined".
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
  ])('[P0] writes %s as an empty string', (_label, days) => {
    expect(formatLeaveDays(days)).toBe('')
  })

  // MEDIA-UI-VAL-005. The plural strings interpolate {{count}} themselves rather than calling
  // formatLeaveDays, so the two must write the same number, in both locales. (Arabic spells out
  // one and two in words, so only counts whose form carries the digit are compared.)
  it.each(['en', 'ar'])('[P1] agrees with how the %s plural strings write {{count}}', (lng) => {
    const t = i18n.getFixedT(lng, 'calendar')
    for (const days of [0.5, 2.5, 3, 10.5]) {
      const text = t('agenda.workingDays', { count: days })
      expect(text, `${lng}: ${days}`).toContain(formatLeaveDays(days))
      expect(text, `${lng}: ${days}`).not.toMatch(/\d\.\d0|\d\.0\b/)
    }
  })
})
