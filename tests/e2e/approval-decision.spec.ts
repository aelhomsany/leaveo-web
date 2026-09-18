import type { APIRequestContext } from '@playwright/test'

import { test, expect } from '../support/fixtures'
import { loginViaApi, loginViaUi, navigateInApp } from '../support/helpers/auth'
import { apiRequest } from '../support/helpers/api-client'
import { createLeaveRequestOnFreeMonday } from '../support/helpers/leave-requests'
import { tags } from '../support/tags'

const password = process.env.E2E_USER_PASSWORD ?? 'PilotDev123!'

/**
 * Story 3.7 — sparse E2E for approve happy path + decline reason guard (FR-13 / UX-DR18).
 * Runs in CI via the leaveo-web `e2e-with-api` job (`E2E_API_AVAILABLE=true`).
 *
 * The two decision tests each provision their OWN pending request and act on that one by id.
 * They used to take `approve-btn-*`/`decline-btn-*` `.first()` from the curated demo seed and
 * consume it, which permanently removed one of the two seeded pending requests for the rest of
 * the run. Six other specs read that fixture — approval-inbox, approval-decisions-visibility
 * (which asserts the badge reads exactly "2"), approval-decision-confidence, demo-data-curated,
 * dashboard-recent-and-sidebar and responsive-tables — so whichever of them happened to run
 * after these two failed, and which ones those were changed with worker count and ordering.
 * Targeting a self-provisioned request also makes these assertions stricter: they now prove a
 * specific known request left the inbox, not merely that some row did.
 */

// Omar deliberately: he is one of Alex's direct reports but the demo seed gives him NO leave
// requests and no spec asserts anything about him. Provisioning as Sarah instead put a second
// "Sarah Chen" card in the approvals list (breaking approval-inbox's strict-mode locator) and
// consumed her Annual Leave balance (breaking dashboard-balances' exact "17 left"). Picking the
// unasserted report keeps these tests from perturbing anything another spec reads.
const REQUESTER = { email: 'omar@company.com', password, timezone: 'Africa/Cairo' }

/** Creates a PENDING request for one of Alex's direct reports and returns its id. */
async function provisionPendingRequest(request: APIRequestContext, note: string): Promise<number> {
  const { accessToken } = await loginViaApi(request, REQUESTER)

  const leaveTypes = await apiRequest<Array<{ id: number; name: string }>>({
    request,
    method: 'GET',
    path: '/api/v1/leave-types',
    token: accessToken,
  })
  const annual = leaveTypes.find((type) => type.name === 'Annual Leave')
  expect(annual, 'Annual Leave must exist in the seeded organization').toBeTruthy()

  // Far enough ahead not to collide with the seeded requests. All three tests here, and
  // leave-cancellation.spec.ts, provision leave for Omar, and the API refuses a second request
  // on a date he already has, so each one lands on the first Monday–Tuesday he still has free.
  return createLeaveRequestOnFreeMonday(request, {
    token: accessToken,
    leaveTypeId: annual!.id,
    offsetDays: 60,
    note,
  })
}

test.describe('Approval decision — Story 3.7', { tag: [tags.regression, tags.api] }, () => {
  test.skip(
    process.env.E2E_API_AVAILABLE !== 'true',
    'Set E2E_API_AVAILABLE=true when leaveo-api is running for pilot approval seed data',
  )

  test('[P1] Manager approves a pending row and it disappears from the inbox', async ({
    page,
    request,
  }) => {
    const requestId = await provisionPendingRequest(request, 'E2E approve journey')

    await loginViaUi(page, { email: 'alex@company.com', password })
    await navigateInApp(page, '/approvals')

    await expect(page.getByTestId('approvals-page')).toBeVisible()
    const approve = page.getByTestId(`approve-btn-${requestId}`)
    await expect(approve).toBeEnabled()

    await approve.click()
    await expect(page.getByTestId('approvals-decision-feedback')).toContainText(/approved/i)
    await expect(page.getByTestId(`approval-card-${requestId}`)).toHaveCount(0)
  })

  test('[P1] Decline confirm is blocked until a reason is entered', async ({ page, request }) => {
    // Non-destructive: the modal is opened and abandoned, so this one could have kept using the
    // seeded fixture. It provisions its own anyway, so all three tests in this file are
    // independent of each other's ordering.
    const requestId = await provisionPendingRequest(request, 'E2E decline guard')

    await loginViaUi(page, { email: 'alex@company.com', password })
    await navigateInApp(page, '/approvals')

    await page.getByTestId(`decline-btn-${requestId}`).click()
    await expect(page.getByTestId('decline-modal')).toBeVisible()
    await expect(page.getByTestId('decline-confirm-btn')).toBeDisabled()

    await page.getByTestId('decline-reason-input').fill('Coverage gap that week')
    await expect(page.getByTestId('decline-confirm-btn')).toBeEnabled()
  })

  test('[P1] Manager declines a pending row and it disappears from the inbox', async ({
    page,
    request,
  }) => {
    const requestId = await provisionPendingRequest(request, 'E2E decline journey')

    await loginViaUi(page, { email: 'alex@company.com', password })
    await navigateInApp(page, '/approvals')

    const decline = page.getByTestId(`decline-btn-${requestId}`)
    await expect(decline).toBeEnabled()

    await decline.click()
    await page.getByTestId('decline-reason-input').fill('Coverage gap that week')
    await page.getByTestId('decline-confirm-btn').click()
    await expect(page.getByTestId('approvals-decision-feedback')).toContainText(/declined/i)
    await expect(page.getByTestId(`approval-card-${requestId}`)).toHaveCount(0)
  })
})
