import { describe, expect, it } from 'vitest'

import { mergeCalendarMonths } from './mergeCalendarMonths'
import { mockCalendarMonth } from './calendarTestFixtures'

import type { CalendarAbsenceResponse, CalendarMonthResponse } from '../../api/generated/types'

// A hardcoded `-28` was wrong for every month the merge is actually exercised over (June has 30
// days, July 31), and a fixture that misstates its own window is the kind that quietly teaches the
// next test the wrong boundary. Day 0 of the following month is the last day of this one.
function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

function monthResponse(
  month: string,
  availableCountByDate: Record<string, number> | undefined,
  overrides: Partial<CalendarMonthResponse> = {},
): CalendarMonthResponse {
  return {
    ...mockCalendarMonth,
    month,
    monthStart: `${month}-01`,
    monthEnd: lastDayOf(month),
    absences: [],
    holidays: [],
    // `availableCountByDate` is required (never actually omitted by the server -- CalendarService
    // always computes it), but this suite deliberately builds an input the real contract can no
    // longer send, to pin mergeCalendarMonths's own `!= null` fallback (still implemented
    // unconditionally in production). Narrow cast, not a widened type: `undefined` is real data a
    // caller of this helper may still pass.
    availableCountByDate: availableCountByDate as Record<string, number>,
    ...overrides,
  }
}

function absence(requestId: number, overrides: Partial<CalendarAbsenceResponse> = {}) {
  return { ...mockCalendarMonth.absences[0], requestId, ...overrides }
}

describe('mergeCalendarMonths', () => {
  // AVAIL-UI-VAL-004 (P1): `availableCountByDate` is date-keyed like absences and holidays, so a
  // cross-month week has to union it the same way. Carrying it from the primary month alone
  // leaves every day of the secondary month with no entry -- which a consumer reading a
  // Jun 28 - Jul 4 week cannot distinguish from "the server never computed those days".
  it('[P1] unions the day-keyed availability map across both months', () => {
    const merged = mergeCalendarMonths(
      [
        monthResponse('2026-06', { '2026-06-30': 6 }),
        monthResponse('2026-07', { '2026-07-01': 4 }),
      ],
      '2026-06',
    )

    expect(merged.month).toBe('2026-06')
    expect(merged.availableCountByDate).toEqual({ '2026-06-30': 6, '2026-07-01': 4 })
  })

  // A server that omits the map entirely must stay omitted, not become `{}`: an empty object is a
  // map that was computed and found empty, which reads as "no day has a count" rather than "this
  // response does not carry counts". `CalendarAgenda` renders those two states differently.
  it('[P1] leaves the map undefined when no month carried one', () => {
    const merged = mergeCalendarMonths(
      [monthResponse('2026-06', undefined), monthResponse('2026-07', undefined)],
      '2026-06',
    )

    expect(merged.availableCountByDate).toBeUndefined()
  })

  // Code review 2026-08-30. The merge holds one collision policy -- the preferred month wins --
  // and it has to hold for every field at once, or a consumer reading a day that both responses
  // describe gets the June answer from one field and the July answer from the next. This pins all
  // three carriers on the same shared day.
  it('[P1] resolves every field of a shared day in favour of the preferred month', () => {
    const merged = mergeCalendarMonths(
      [
        monthResponse('2026-07', { '2026-06-30': 1 }, { absences: [absence(99, { userFullName: 'July Copy' })] }),
        monthResponse('2026-06', { '2026-06-30': 6 }, { absences: [absence(99, { userFullName: 'June Copy' })] }),
      ],
      '2026-06',
    )

    expect(merged.month).toBe('2026-06')
    expect(merged.availableCountByDate).toEqual({ '2026-06-30': 6 })
    expect(merged.absences).toHaveLength(1)
    expect(merged.absences[0].userFullName).toBe('June Copy')
  })

  // The `?? responses[0]` fallback. A week can straddle two months without either being the one
  // the caller asked for -- a stale `preferredMonth` after the user pages, say -- and returning
  // nothing there would blank the calendar. The first response stands in, and the union is still
  // complete.
  it('[P1] falls back to the first response when no month matches the preferred one', () => {
    const merged = mergeCalendarMonths(
      [
        monthResponse('2026-06', { '2026-06-30': 6 }),
        monthResponse('2026-07', { '2026-07-01': 4 }),
      ],
      '2026-08',
    )

    expect(merged.month).toBe('2026-06')
    expect(merged.availableCountByDate).toEqual({ '2026-06-30': 6, '2026-07-01': 4 })
  })

  // The guard. An empty array reaches `...primary` as `undefined` and would otherwise spread into
  // a response-shaped object with every field missing -- a silent blank calendar instead of an
  // error the caller can surface.
  it('[P1] throws rather than returning a hollow month when there is nothing to merge', () => {
    expect(() => mergeCalendarMonths([], '2026-06')).toThrow('Calendar month data is required.')
  })
})
