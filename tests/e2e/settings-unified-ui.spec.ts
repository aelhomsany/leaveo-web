import { test, expect } from '../support/fixtures'
import { loginViaUi, navigateInApp } from '../support/helpers/auth'
import { tags } from '../support/tags'

const password = process.env.E2E_USER_PASSWORD ?? 'PilotDev123!'

/**
 * Story 2.7 — unified Settings page composition.
 * Remove outer skip when leaveo-api is unavailable in CI; inner tests assert implemented UI.
 */
test.describe('Settings unified UI — Story 2.7', { tag: [tags.regression, tags.api] }, () => {
  test.skip(
    process.env.E2E_API_AVAILABLE !== 'true',
    'Set E2E_API_AVAILABLE=true when leaveo-api is running for settings data',
  )

  test('[P1] Organization Admin sees subtitle and three policy cards in mockup order', async ({ page }) => {
    await loginViaUi(page, { email: 'jordan@company.com', password })
    await navigateInApp(page, '/settings')

    // exact: true — Story 11.5's settings information architecture added a visually hidden
    // <h2>Settings categories</h2>, so the substring match now resolves to two headings and
    // fails Playwright strict mode. The assertion still targets the page's own <h1>.
    await expect(page.getByRole('heading', { name: 'Organization Settings', exact: true })).toBeVisible()
    await expect(
      page.getByText('Company policy, team, and leave entitlements'),
    ).toBeVisible()

    const workforce = page.getByTestId('workforce-groups-weekends-card')
    await expect(workforce).toBeVisible()
    await expect(page.getByTestId('leave-types-card')).toHaveCount(0)
    await expect(page.getByTestId('team-members-card')).toHaveCount(0)

    await page.getByTestId('settings-category-leave-policies').click()
    await expect(page.getByTestId('leave-types-card')).toBeVisible()
    await expect(workforce).toHaveCount(0)

    await page.getByTestId('settings-category-people').click()
    await expect(page.getByTestId('team-members-card')).toBeVisible()
    await expect(page.getByTestId('leave-types-card')).toHaveCount(0)
  })

  test('[P1] Leave Types card shows five seeded types with uncapped Unpaid copy', async ({
    page,
  }) => {
    await loginViaUi(page, { email: 'jordan@company.com', password })
    await navigateInApp(page, '/settings?category=leave-policies')

    await expect(page.getByTestId('leave-types-card')).toBeVisible()
    // The card's "Default entitlements" support note repeats every type name and entitlement,
    // so the assertions are scoped to the list itself.
    const list = page.getByTestId('leave-types-list')
    await expect(list).toBeVisible()
    await expect(list.getByText('Annual Leave')).toBeVisible()
    await expect(list.getByText('20 days default')).toBeVisible()
    await expect(list.getByText('Unpaid Leave')).toBeVisible()
    await expect(list.getByText('Unlimited / custom')).toBeVisible()
  })

  test('[P1] + Add Group creates a new workforce group tab', async ({ page }) => {
    await loginViaUi(page, { email: 'jordan@company.com', password })
    // Workforce Groups live under the working-calendars category since the Settings IA
    // refresh; the old flat "Manage Groups" link no longer exists.
    await navigateInApp(page, '/settings?category=working-calendars')
    await expect(page.getByTestId('settings-panel-working-calendars')).toBeVisible()

    await page.getByTestId('add-group-btn').click()
    await expect(page.getByTestId('workforce-group-modal')).toBeVisible()

    const modal = page.getByTestId('workforce-group-modal')
    const groupName = `UK-${Date.now()}`
    await modal.getByLabel(/group name/i).fill(groupName)
    await modal.getByRole('checkbox', { name: /Sat weekend day/i }).check()
    await modal.getByRole('checkbox', { name: /Sun weekend day/i }).check()
    await page.getByTestId('create-group-submit').click()

    await expect(page.getByRole('tab', { name: groupName })).toBeVisible()
    const toast = page.getByTestId('app-toast')
    await expect(toast).toContainText(new RegExp(`${groupName}|created`, 'i'))
    await expect(toast).toHaveAttribute('data-tone', 'success')
  })
})
