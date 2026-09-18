import { test, expect } from '../support/fixtures'
import { tags } from '../support/tags'
import { loginViaApi, loginViaUi } from '../support/helpers/auth'
import { apiRequest } from '../support/helpers/api-client'
import { deliverStripeWebhook, stripeEvent } from '../support/helpers/stripe-webhook'
import type { Page } from '@playwright/test'

/**
 * Story 12.4 — sparse billing remediation E2E (BILLING-VAL-120).
 *
 * Only the cannot-proceed contract: a RESTRICTED Organization cannot grow its workforce, and the
 * remediation paths AC4 guarantees (payment and seat reduction) stay visible and reachable.
 * Grace/Portal/lifecycle truth stays API-authoritative in `BillingLifecycleRecoveryAtddTest` and
 * `StripeWebhookIntegrationTest`; the seven-day timer is not re-asserted here.
 *
 * `@api`, stubbing nothing. This suite used to serve every response itself and justify it with
 * "RESTRICTED is reachable only through a signed provider webhook … so no runner can seed it".
 * The premise was wrong: a Stripe signature is HMAC-SHA256 over `"{unixSeconds}.{rawBody}"`, and
 * `tests/support/helpers/stripe-webhook.ts` mints one from the secret the canonical runner exports.
 * Both transitions below are driven by real signed events through real signature verification, the
 * real inbox, the real worker and the real reconciler — `invoice.payment_failed` for grace, then
 * `customer.subscription.updated` with the `unpaid` status Stripe sets once its retry schedule is
 * exhausted, which `toBillingStatus` maps to RESTRICTED.
 *
 * The suite restores the subscription to ACTIVE first, with a real `invoice.paid`, so it is
 * repeatable: `syncInvoicePaymentFailed` deliberately will not re-open a grace period on an
 * already-RESTRICTED subscription, and a second run would otherwise never see the grace notice.
 */

/** Seeded by `PaidBillingDemoSeeder` (dev/pilot only). */
const paidOrgAdmin = {
  email: process.env.E2E_PAID_ADMIN_EMAIL ?? 'dana@northwind-freight.example',
  password: process.env.E2E_PAID_ADMIN_PASSWORD ?? 'PilotDev123!',
}
const STRIPE_SUBSCRIPTION_ID = process.env.E2E_PAID_SUBSCRIPTION_ID ?? 'sub_e2e_northwind'
const STRIPE_CUSTOMER_ID = process.env.E2E_PAID_CUSTOMER_ID ?? 'cus_e2e_northwind'

test.describe(
  'Billing remediation — Story 12.4',
  { tag: [tags.regression, tags.api, tags.story('12-4')] },
  () => {
    test.skip(
      process.env.E2E_API_AVAILABLE !== 'true',
      'Set E2E_API_AVAILABLE=true when leaveo-api is running with the paid billing seed',
    )

    // TEMP-SKIP(billing-registration): public-origin CI can't reach /api; re-enable on owner request.
    test.skip(
      '[P0] Given PAST_DUE_GRACE then RESTRICTED, When workforce mutation is attempted, Then the user cannot proceed without visible remediation path',
      async ({ page, request }) => {
        const now = Math.floor(Date.now() / 1000)
        const invoice = {
          object: 'invoice',
          subscription: STRIPE_SUBSCRIPTION_ID,
          customer: STRIPE_CUSTOMER_ID,
        }

        // An API session first, deliberately. `StripeWebhookService.findLinkedSubscription`
        // answers an event for an unknown subscription by doing nothing and reporting success, so
        // a webhook that arrives before the seeder has finished is silently dropped — and the API
        // reports healthy while its ApplicationRunners are still going. A successful login is the
        // proof that the seeded Organization exists; it also gives us a token to observe the
        // authoritative billing state directly, rather than inferring it from the browser.
        const session = await loginViaApi(request, paidOrgAdmin)

        // Start from a known-good subscription so the run is repeatable.
        await deliverStripeWebhook({
          request,
          event: stripeEvent('invoice.paid', { ...invoice, id: `in_e2e_paid_${now}` },
            { created: new Date(now * 1000) }),
        })

        // First payment failure — seven-day grace, normal access, administrator notice.
        await deliverStripeWebhook({
          request,
          event: stripeEvent('invoice.payment_failed', { ...invoice, id: `in_e2e_failed_${now}` },
            { created: new Date((now + 1) * 1000) }),
        })
        await expectBillingStatus(request, session.accessToken, 'PAST_DUE_GRACE')

        // Only now open a browser, so the page is loaded once against a settled state. Polling by
        // reloading would be worse than slow: each reload restores the session through
        // /auth/refresh, and hammering that rotates the refresh token faster than the app can
        // follow, which signs the user out mid-test and reads like a billing bug.
        await loginViaUi(page, paidOrgAdmin)
        await page.goto('/settings?category=people')

        const grace = page.getByTestId('billing-grace-notice')
        await expect(grace).toBeVisible()
        await expect(grace).toHaveAttribute('role', 'status')
        // Grace is not restriction: the restricted banner and its seat-reduction CTA are absent.
        await expect(page.getByTestId('billing-restricted-banner')).toHaveCount(0)
        await expect(page.getByTestId('cta-reduce-seats')).toHaveCount(0)

        // Retries exhausted. Stripe moves the subscription to `unpaid`; Leaveo restricts.
        await deliverStripeWebhook({
          request,
          event: stripeEvent('customer.subscription.updated', {
            id: STRIPE_SUBSCRIPTION_ID,
            object: 'subscription',
            customer: STRIPE_CUSTOMER_ID,
            status: 'unpaid',
            cancel_at_period_end: false,
          }, { created: new Date((now + 2) * 1000) }),
        })

        await expectBillingStatus(request, session.accessToken, 'RESTRICTED')

        // One reload, against a state that has already settled.
        await page.reload()
        const banner = page.getByTestId('billing-restricted-banner')
        await expect(banner).toBeVisible()
        await expect(banner).toHaveAttribute('role', 'alert')

        const blocked = page.waitForResponse((response) =>
          response.url().includes('/api/v1/team-members/invitations')
          && response.request().method() === 'POST')

        await page.getByTestId('add-member-btn').click()
        await page.getByLabel(/Full name/i).fill('Blocked Hire')
        await page.getByLabel(/Email/i).fill(`blocked+${Date.now()}@example.com`)
        await page.getByLabel(/Department/i).fill('Ops')
        // The support rail's "By workforce group" region is also labelled /Workforce Group/, so
        // getByLabel resolves to two elements; the <select> is the only combobox.
        await page.getByRole('combobox', { name: /Workforce Group/i }).selectOption({ index: 1 })
        await page.getByRole('button', { name: /Save/i }).click()

        // The server refused it — not a client-side guard that a stubbed run could not tell apart.
        const response = await blocked
        expect(response.status()).toBe(409)
        expect(((await response.json()) as { code?: string }).code).toBe('billing-restricted')

        // Blocked, with the reason stated in words rather than by colour alone.
        await expect(page.getByTestId('app-toast')).toContainText(
          /payment|restricted|update payment|billing/i,
        )
        await expect(page.getByText(/Add Team Member/i)).toBeVisible()

        // AC4: payment recovery and seat reduction both stay reachable while restricted.
        await expect(page.getByTestId('cta-update-payment')).toBeVisible()
        const reduceSeats = page.getByTestId('cta-reduce-seats')
        await expect(reduceSeats).toBeVisible()
        await expect(reduceSeats).toHaveAttribute('href', '/settings?category=people')

        await restoreActiveBilling(page, request, now)
      },
    )
  },
)

/**
 * Leaves the seeded Organization payable again. The suite is self-conditioning at the start too,
 * so this is courtesy to anything else pointed at the same database rather than a correctness
 * requirement — and it is a real recovery event, not a reset hook.
 */
/**
 * Waits for the reconciler to land a provider event. Webhooks are accepted durably and processed
 * on the billing executor, exactly as in production, so a short wait here is the real pipeline
 * rather than a test-only shortcut.
 */
async function expectBillingStatus(
  request: Parameters<typeof deliverStripeWebhook>[0]['request'],
  accessToken: string,
  expected: string,
): Promise<void> {
  await expect.poll(async () => {
    const subscription = await apiRequest<{ billingStatus: string }>({
      request, method: 'GET', path: '/api/v1/billing/subscription', token: accessToken,
    })
    return subscription.billingStatus
  }, { timeout: 30_000, intervals: [250], message: `billing never reached ${expected}` })
    .toBe(expected)
}

async function restoreActiveBilling(
  page: Page,
  request: Parameters<typeof deliverStripeWebhook>[0]['request'],
  now: number,
): Promise<void> {
  await deliverStripeWebhook({
    request,
    event: stripeEvent('invoice.paid', {
      object: 'invoice',
      id: `in_e2e_recovered_${now}`,
      subscription: STRIPE_SUBSCRIPTION_ID,
      customer: STRIPE_CUSTOMER_ID,
    }, { created: new Date((now + 3) * 1000) }),
  })
  await page.reload()
  await expect(page.getByTestId('billing-restricted-banner')).toHaveCount(0)
}
