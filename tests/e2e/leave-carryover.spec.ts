import type { APIRequestContext } from '@playwright/test'

import { test, expect } from '../support/fixtures'
import { loginViaApi, loginViaUi, logoutViaUi, navigateInApp } from '../support/helpers/auth'
import { apiRequest } from '../support/helpers/api-client'
import { tags } from '../support/tags'

const password = process.env.E2E_USER_PASSWORD ?? 'PilotDev123!'

/**
 * Plan RESTO B7 — the carry-over journey end to end: carried days on the balance card, the request
 * form saying they are used first, a manager's approval spending them, and a cancellation giving
 * them back. The rules themselves (cap, deadline, expiry, forfeit, eligibility by submission date)
 * are proved in CarryoverIntegrationTest and CarryoverChargeIntegrationTest.
 *
 * A carried balance cannot be created through the API — publishing refuses a backdated effective
 * date — so the demo reset (CarryoverDemoSeeder) gives Emma a USER-scoped Annual Leave rule from
 * 1 January last year: 20 days, carry up to 5, use by 31 December. No other spec reads Emma.
 */

const REQUESTER = { email: 'emma@company.com', password }
const MANAGER = { email: 'alex@company.com', password }
const CARD = 'annual-leave'

const iso = (value: Date) => value.toISOString().slice(0, 10)

/** A Monday–Tuesday range `offsetDays` ahead: two working days in the US group. */
function mondayRange(offsetDays: number): { from: string; to: string } {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + offsetDays)
  while (start.getUTCDay() !== 1) {
    start.setUTCDate(start.getUTCDate() + 1)
  }
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { from: iso(start), to: iso(end) }
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

test.describe('Leave carry-over — Plan RESTO', { tag: [tags.regression, tags.api] }, () => {
  test.skip(
    process.env.E2E_API_AVAILABLE !== 'true',
    'Set E2E_API_AVAILABLE=true when leaveo-api is running with the demo reset',
  )

  test('[P1] Carried days are shown, used first on approval, and returned on cancellation', async ({
    page,
    request,
  }) => {
    const range = mondayRange(14)
    test.skip(
      new Date(range.to).getUTCFullYear() !== new Date().getUTCFullYear(),
      'The carried days expire on 31 December; late December has no future range left in the year',
    )

    const carried = page.getByTestId(`balance-carryover-${CARD}`)
    const carriedLeft = (days: number) =>
      new RegExp(`Carried from \\W*${new Date().getUTCFullYear() - 1}\\W*: ${days} days left`)

    // 1. The balance card shows the carried bucket and its deadline.
    await loginViaUi(page, REQUESTER)
    await navigateInApp(page, '/my-leaves')
    await expect(carried).toContainText(carriedLeft(5))
    await expect(carried).toContainText(/Use carried days by/)

    // 2. The request form says the carried days go first, before anything is submitted.
    const { accessToken } = await loginViaApi(request, REQUESTER)
    const leaveTypeId = await annualLeaveId(request, accessToken)
    await page.getByTestId('request-leave-btn').click()
    await expect(page.getByTestId('request-leave-modal')).toBeVisible()
    await page.locator('#leave-type').selectOption(String(leaveTypeId))
    await page.getByTestId('leave-from-date').fill(range.from)
    await page.getByTestId('leave-to-date').fill(range.to)
    await expect(page.getByTestId('request-carryover-breakdown')).toContainText(/Uses 2 carried days/)

    await page.getByTestId('submit-request-btn').click()
    await expect(page.getByTestId('request-leave-modal')).toHaveCount(0)

    const mine = await apiRequest<Array<{ id: number; leaveTypeId: number; dateFrom: string; status: string }>>({
      request,
      method: 'GET',
      path: '/api/v1/leave-requests',
      token: accessToken,
    })
    const created = mine.find(
      (row) => row.leaveTypeId === leaveTypeId && row.dateFrom === range.from && row.status === 'PENDING',
    )
    expect(created, 'the submitted request must be listed for the requester').toBeTruthy()
    const requestId = created!.id

    // 3. The manager approves it; approval is what charges the carried bucket.
    await logoutViaUi(page)
    await loginViaUi(page, MANAGER)
    await navigateInApp(page, '/approvals')
    await page.getByTestId(`approve-btn-${requestId}`).click()
    await expect(page.getByTestId('approvals-decision-feedback')).toContainText(/approved/i)

    await logoutViaUi(page)
    await loginViaUi(page, REQUESTER)
    await navigateInApp(page, '/my-leaves')
    await expect(carried).toContainText(carriedLeft(3))

    // 4. Cancelling leave that has not started gives the carried days back to the carried bucket.
    await page.getByTestId(`my-leaves-cancel-button-${requestId}`).first().click()
    await expect(page.getByTestId('cancel-leave-modal')).toBeVisible()
    await page.getByTestId('cancel-confirm-btn').click()
    await expect(page.getByTestId('cancel-leave-modal')).toHaveCount(0)
    await expect(carried).toContainText(carriedLeft(5))
  })
})
