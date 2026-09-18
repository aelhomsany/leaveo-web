import type { APIRequestContext } from '@playwright/test'

import { apiRequest } from './api-client'

export type DateRange = { from: string; to: string }

const iso = (value: Date) => value.toISOString().slice(0, 10)

/**
 * A two-working-day range starting on a Monday, `offsetDays` from today. Monday–Tuesday contains
 * working days under both the US (Sat/Sun) and Egypt (Fri/Sat) weekends; a negative offset walks
 * backwards so the range has already started.
 */
export function mondayRange(offsetDays: number): DateRange {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + offsetDays)
  const step = offsetDays < 0 ? -1 : 1
  while (start.getUTCDay() !== 1) {
    start.setUTCDate(start.getUTCDate() + step)
  }
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { from: iso(start), to: iso(end) }
}

const MAX_WEEKS = 20

/**
 * Creates a leave request on the first future Monday–Tuesday, `offsetDays` ahead or a whole number
 * of weeks later, that the requester does not already have booked. Returns the new request's id.
 *
 * The API refuses a request that overlaps one the person already has pending or approved (Plan
 * MEDIA's overlap guard: 409 `leave-request-overlaps`). Specs provision leave for the same seeded
 * requester, and CI retries a failed test against the same database, so one fixed range collides
 * with an earlier test or with the attempt being retried. Each refusal moves the range a week.
 */
export async function createLeaveRequestOnFreeMonday(
  request: APIRequestContext,
  options: { token: string; leaveTypeId: number; offsetDays: number; note: string },
): Promise<number> {
  const { token, leaveTypeId, offsetDays, note } = options
  if (offsetDays <= 0) {
    throw new Error('createLeaveRequestOnFreeMonday only walks forward; pass a future offset')
  }

  for (let week = 0; week < MAX_WEEKS; week += 1) {
    const range = mondayRange(offsetDays + week * 7)
    try {
      const created = await apiRequest<{ id: number }>({
        request,
        method: 'POST',
        path: '/api/v1/leave-requests',
        token,
        data: { leaveTypeId, dateFrom: range.from, dateTo: range.to, note },
      })
      return created.id
    } catch (error) {
      // apiRequest puts the problem-details body in the message. Only an overlap moves on.
      if (!(error instanceof Error) || !error.message.includes('/errors/leave-request-overlaps')) {
        throw error
      }
    }
  }

  throw new Error(
    `No free Monday–Tuesday within ${MAX_WEEKS} weeks of ${mondayRange(offsetDays).from}. ` +
      'An E2E database reused across many local runs fills up; reset it.',
  )
}
