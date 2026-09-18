import type { APIRequestContext } from '@playwright/test'

import { test, expect } from '../support/fixtures'
import { loginViaApi, loginViaUi, logoutViaUi, navigateInApp } from '../support/helpers/auth'
import { apiRequest } from '../support/helpers/api-client'
import { tags } from '../support/tags'

const password = process.env.E2E_USER_PASSWORD ?? 'PilotDev123!'

/**
 * Plan MEDIA / MEDIA-VAL-E2E-001 — a half day end to end: the request form offers the half on a
 * one-date request and prices it at 0.5 before anything is sent, the manager sees that price on
 * the approval card, and once approved the agenda says which half of the day the person is away.
 * The rules themselves (costing, the overlap guard, charging, carry-over, corrections, imports)
 * are proved in the API suite, and the form's own rules in RequestLeaveModal.half-day.test.tsx.
 */

// Omar is one of Alex's direct reports and the demo seed gives him no leave. approval-decision
// and leave-cancellation provision Monday–Tuesday requests for him; this one books Wednesdays.
const REQUESTER = { email: 'omar@company.com', password }
const MANAGER = { email: 'alex@company.com', password }

type OwnRequest = {
  id: number
  leaveTypeId: number
  dateFrom: string
  dateTo: string
  workingDays: number
  status: string
}

const iso = (value: Date) => value.toISOString().slice(0, 10)

/** The first Wednesday `offsetDays` or more from today: a working day in both seeded groups. */
function wednesday(offsetDays: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  while (date.getUTCDay() !== 3) {
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return iso(date)
}

async function annualLeaveId(request: APIRequestContext, token: string): Promise<number> {
  const leaveTypes = await apiRequest<Array<{ id: number; name: string }>>({
    request,
    method: 'GET',
    path: '/api/v1/leave-types',
    token,
  })
  const annual = leaveTypes.find((type) => type.name === 'Annual Leave')
  expect(annual, 'Annual Leave must exist in the seeded organization').toBeTruthy()
  return annual!.id
}

async function ownRequests(request: APIRequestContext, token: string): Promise<OwnRequest[]> {
  return apiRequest<OwnRequest[]>({ request, method: 'GET', path: '/api/v1/leave-requests', token })
}

const MAX_WEEKS = 20

/**
 * The first Wednesday from three weeks out that Omar has nothing booked on and his group works.
 *
 * The overlap guard refuses a second morning on a date he already has, and CI retries a failed
 * test against the same database, so a fixed date collides with the attempt before it. A holiday
 * is skipped rather than booked: a half day on one is refused, never moved (MEDIA-VAL-006).
 */
async function freeWorkingWednesday(
  request: APIRequestContext,
  token: string,
  leaveTypeId: number,
): Promise<string> {
  const booked = (await ownRequests(request, token)).filter(
    (row) => row.status === 'PENDING' || row.status === 'APPROVED',
  )
  for (let week = 0; week < MAX_WEEKS; week += 1) {
    const date = wednesday(21 + week * 7)
    if (booked.some((row) => row.dateFrom <= date && date <= row.dateTo)) {
      continue
    }
    try {
      const preview = await apiRequest<{ chargedDays: number }>({
        request,
        method: 'POST',
        path: '/api/v1/leave-requests/preview',
        token,
        data: { leaveTypeId, dateFrom: date, dateTo: date, startPart: 'FIRST_HALF', endPart: 'FIRST_HALF' },
      })
      if (preview.chargedDays === 0.5) {
        return date
      }
    } catch (error) {
      // apiRequest puts the problem-details body in the message. Only a refused date moves on.
      if (!(error instanceof Error) || !error.message.includes(' 400 ')) {
        throw error
      }
    }
  }
  throw new Error(
    `No free working Wednesday within ${MAX_WEEKS} weeks of ${wednesday(21)}. ` +
      'An E2E database reused across many local runs fills up; reset it.',
  )
}

test.describe('Half-day leave — Plan MEDIA', { tag: [tags.regression, tags.api] }, () => {
  test.skip(
    process.env.E2E_API_AVAILABLE !== 'true',
    'Set E2E_API_AVAILABLE=true when leaveo-api is running with the demo reset',
  )

  test('[P1] Employee books a morning off at half a day, the manager approves it, and the agenda shows the morning', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginViaApi(request, REQUESTER)
    const leaveTypeId = await annualLeaveId(request, accessToken)
    const date = await freeWorkingWednesday(request, accessToken, leaveTypeId)

    // 1. The form offers the half once the range is one date, and prices it before submission.
    await loginViaUi(page, REQUESTER)
    await navigateInApp(page, '/my-leaves')
    await page.getByTestId('request-leave-btn').click()
    await expect(page.getByTestId('request-leave-modal')).toBeVisible()
    await page.locator('#leave-type').selectOption(String(leaveTypeId))
    await page.getByTestId('leave-from-date').fill(date)
    await page.getByTestId('leave-to-date').fill(date)
    await expect(page.getByTestId('day-part-single')).toBeVisible()
    await page.locator('#leave-day-part').selectOption('FIRST_HALF')
    await expect(page.getByTestId('working-day-preview')).toContainText('0.5 working days will be charged')

    await page.getByTestId('submit-request-btn').click()
    await expect(page.getByTestId('request-leave-modal')).toHaveCount(0)

    const created = (await ownRequests(request, accessToken)).find(
      (row) => row.leaveTypeId === leaveTypeId && row.dateFrom === date && row.status === 'PENDING',
    )
    expect(created, 'the submitted request must be listed for the requester').toBeTruthy()
    expect(created!.workingDays, 'what was submitted is what the preview priced').toBe(0.5)
    const requestId = created!.id

    // 2. The manager decides on the half: the card prices the request at what it costs.
    await logoutViaUi(page)
    await loginViaUi(page, MANAGER)
    await navigateInApp(page, '/approvals')
    await expect(page.getByTestId(`approval-card-${requestId}`)).toContainText('0.5 working days')
    await page.getByTestId(`approve-btn-${requestId}`).click()
    await expect(page.getByTestId('approvals-decision-feedback')).toContainText(/approved/i)

    // 3. The agenda names the half, not only the fraction: away this morning, back after lunch.
    await navigateInApp(page, '/calendar')
    await expect(page.getByTestId('team-calendar-page')).toBeVisible()
    await page.getByRole('button', { name: 'Agenda' }).click()
    await expect(page.getByTestId('calendar-agenda')).toBeVisible()
    const day = page.getByTestId(`calendar-day-${date}`)
    for (let month = 0; month < 6 && (await day.count()) === 0; month += 1) {
      await page.getByTestId('calendar-next-month').click()
      await expect(page.getByTestId('team-calendar-loading')).not.toBeVisible()
    }
    await day.click()

    const absence = page.getByTestId(`calendar-agenda-day-${date}`).getByTestId(`calendar-event-${requestId}`)
    await expect(absence).toBeVisible()
    await expect(absence.getByTestId('calendar-agenda-day-part')).toHaveText('Morning')
  })
})
