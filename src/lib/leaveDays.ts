import type { CreateLeaveRequestRequest } from '../api/generated/types'

/**
 * Half-day leave on the client side (Plan MEDIA).
 *
 * The server keeps every measured quantity in half-day units and converts once, at the API edge,
 * so everything that reaches this file is already a number of days -- 2.5, never 5. Nothing here
 * multiplies or divides by two, and nothing should: a client that does its own unit arithmetic is
 * a second source of truth for what a request costs.
 */

/** Which part of a working day a request covers. Mirrors the server's `DayPart`. */
export type DayPart = NonNullable<CreateLeaveRequestRequest['startPart']>

export const FULL_DAY = 'FULL' satisfies DayPart
/** "Morning" in English -- see `common:dayParts`. */
export const FIRST_HALF = 'FIRST_HALF' satisfies DayPart
/** "Afternoon" in English. */
export const SECOND_HALF = 'SECOND_HALF' satisfies DayPart

/**
 * The shortest correct text for a day count: `3`, `2.5`, `-0.5`.
 *
 * The same rule as the server's `LeaveDays.format`, and for the same reason -- a whole number never
 * grows a `.0` tail, because "3.0 days of annual leave" is not how anyone writes it. Digits stay
 * Latin, as every other number in this UI already is; localising them is a decision for the whole
 * app rather than for leave alone, and this is the one place it would be made.
 *
 * Not for an i18next `count`, which must stay numeric so plural selection works. i18next's own
 * interpolation of `{{count}}` produces the same text this does, so the two agree on screen.
 */
export function formatLeaveDays(days: number | null | undefined): string {
  if (days == null || Number.isNaN(days)) {
    return ''
  }
  return Number.isInteger(days) ? String(days) : days.toFixed(1)
}
