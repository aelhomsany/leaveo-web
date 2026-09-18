import { test, expect } from '../support/fixtures'
import { tags } from '../support/tags'

/**
 * Story 12.2 — sparse Contact Sales E2E (SALES-VAL-012 + visible AC3 success).
 * Minimization, follow-up consent, idempotency, and no-Organization side effects
 * are API-authoritative; this suite only proves the user cannot proceed without
 * visible no-workspace success feedback.
 */
test.describe(
  'Contact Sales handoff — Story 12.2',
  { tag: [tags.regression, tags.api, tags.story('12-2')] },
  () => {
    // TEMP-SKIP(billing-registration): public-origin CI can't reach /api; re-enable on owner request.
    test.skip(
      '[P0] Given a >200 or complex prospect, When Contact Sales is submitted, Then the lead is recorded with no workspace and an explicit success state',
      async ({ page }) => {
        await page.goto('/contact-sales?intendedCount=250&plan=CONTACT_SALES')

        await expect(page.getByTestId('contact-sales-intended-count')).toHaveValue('250')

        await page.getByTestId('contact-sales-company').fill('Acme Distributed')
        await page.getByTestId('contact-sales-contact-name').fill('Pat Lee')
        await page.getByTestId('contact-sales-email').fill(`pat+${Date.now()}@acme.example`)
        await page.getByTestId('contact-sales-country').fill('US')
        await page.getByTestId('contact-sales-context').fill('Need migration help')

        // Follow-up consent is required before submit (SPA guard; API still authoritative).
        await expect(page.getByTestId('contact-sales-submit')).toBeDisabled()
        await page.getByTestId('contact-sales-follow-up-consent').check()
        await expect(page.getByTestId('contact-sales-submit')).toBeEnabled()

        await page.getByTestId('contact-sales-submit').focus()
        await page.keyboard.press('Enter')

        await expect(page.getByTestId('contact-sales-success')).toBeVisible()
        await expect(page.getByTestId('contact-sales-no-workspace')).toBeVisible()
        await expect(page.getByText(/no workspace was created/i)).toBeVisible()
        await expect(page.getByText(/welcome to leaveo/i)).toHaveCount(0)

        for (const width of [390, 768, 900, 901, 1280, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          const layout = await page.evaluate(() => ({
            viewport: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
          }))
          expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport)
        }

        await page.goto('/ar/contact-sales?intendedCount=250&plan=CONTACT_SALES')
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        await expect(page.getByTestId('contact-sales-email')).toHaveAttribute('dir', 'ltr')
        await expect(page.getByTestId('contact-sales-follow-up-consent')).not.toBeChecked()
      },
    )
  },
)
