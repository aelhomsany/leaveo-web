import { test, expect } from '../support/fixtures'
import { loginViaUi, navigateInApp } from '../support/helpers/auth'
import { tags } from '../support/tags'

const password = process.env.E2E_USER_PASSWORD ?? 'PilotDev123!'
const firstUseHrEmail =
  process.env.E2E_FIRST_USE_HR_EMAIL ?? 'laila@saffron-studios.example'

/**
 * Checks real geometry, not just documentElement.scrollWidth: an ancestor
 * using `overflow-x: clip`/`hidden` clamps that number, so a clipped-but-
 * unreachable overflow would otherwise report as passing.
 */
async function expectPageDoesNotOverflow(
  page: import('@playwright/test').Page,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const limit = window.innerWidth + 1
        if (document.documentElement.scrollWidth > limit) {
          return `documentElement scrollWidth ${document.documentElement.scrollWidth} > ${limit}`
        }
        for (const el of document.querySelectorAll<HTMLElement>(
          '.auth-page, .auth-layout, .auth-card, .auth-proof-panel, .auth-proof-example, .auth-proof-days, .auth-proof-day',
        )) {
          const rect = el.getBoundingClientRect()
          if (rect.left < -1 || rect.right > limit) {
            return `${el.className} escapes viewport (left ${Math.round(rect.left)}, right ${Math.round(rect.right)}, limit ${limit})`
          }
          if (el.scrollWidth > Math.ceil(rect.width) + 1) {
            return `${el.className} content clipped (scrollWidth ${el.scrollWidth} > width ${Math.round(rect.width)})`
          }
        }
        return 'ok'
      }),
    )
    .toBe('ok')
}

/** AC10 / L9 viewport matrix. */
const AUTH_VIEWPORTS = [390, 768, 900, 901, 1280, 1440] as const

/**
 * Story 11.7 — first-use deep-link / auth navigation proof.
 * Credential and security rules stay in Auth*IntegrationTest.
 * Smoke login remains `auth-login.spec.ts` / `platform-admin-auth.spec.ts`.
 */
test.describe(
  'Auth and first-use — Story 11.7',
  { tag: [tags.regression, tags.api, tags.story('11-7')] },
  () => {
    test.skip(
      process.env.E2E_API_AVAILABLE !== 'true',
      'Set E2E_API_AVAILABLE=true when leaveo-api is running for HR seed data',
    )

    test(
      '[P1] Given Organization Admin with incomplete first-use, When My Leaves loads, Then cue CTA opens Working calendars',
      async ({ page }) => {
        await loginViaUi(page, { email: firstUseHrEmail, password })
        // The first-use cue moved with the greeting to My Leaves when the Dashboard
        // merged into it (2026-09-01); '/' now redirects to the Team Calendar.
        await navigateInApp(page, '/my-leaves')

        await expect(page.getByTestId('my-leaves-page')).toBeVisible()
        const cue = page.getByTestId('first-use-cue')
        await expect(cue).toBeVisible()
        await expect(page.getByTestId('first-use-step-1')).toHaveAttribute(
          'aria-current',
          'step',
        )

        for (const width of AUTH_VIEWPORTS) {
          await page.setViewportSize({ width, height: 900 })
          await expect(cue).toBeVisible()
          await expectPageDoesNotOverflow(page)
        }

        await page.setViewportSize({ width: 1440, height: 900 })
        await page.getByTestId('language-switcher').click()
        await page.getByRole('menuitemradio', { name: 'العربية' }).click()
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        await expect(cue).toContainText('اضبط حساب أيام العمل بدقة')

        for (const width of AUTH_VIEWPORTS) {
          await page.setViewportSize({ width, height: 900 })
          await expect(cue).toBeVisible()
          await expectPageDoesNotOverflow(page)
        }

        await page.setViewportSize({ width: 1440, height: 900 })
        await page.getByTestId('language-switcher').click()
        await page.getByRole('menuitemradio', { name: 'English' }).click()
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')

        await page.getByTestId('first-use-cta').click()

        await expect(page).toHaveURL(/\/settings\?.*category=working-calendars/)
        await expect(page.getByTestId('settings-page')).toBeVisible()
      },
    )
  },
)

test.describe(
  'Auth responsive and locale proof — Story 11.7',
  { tag: [tags.regression, tags.uiOnly, tags.story('11-7')] },
  () => {
    test(
      '[P0] Given English or Arabic across the viewport matrix, When Login renders, Then form-first order and containment hold',
      async ({ page }) => {
        for (const locale of ['en', 'ar'] as const) {
          for (const width of AUTH_VIEWPORTS) {
            await page.setViewportSize({ width, height: 900 })
            await page.goto('/login')
            await page.evaluate((language) => {
              localStorage.setItem('leaveo.preferredLanguage', language)
            }, locale)
            await page.reload()

            await expect(page.locator('html')).toHaveAttribute('lang', locale)
            await expect(page.locator('html')).toHaveAttribute(
              'dir',
              locale === 'ar' ? 'rtl' : 'ltr',
            )
            await expect(page.getByTestId('sign-in-submit')).toBeVisible()
            await expect(page.getByTestId('auth-proof-panel')).toBeVisible()
            await expectPageDoesNotOverflow(page)

            const formPrecedesProof = await page.evaluate(() => {
              const submit = document.querySelector(
                '[data-testid="sign-in-submit"]',
              )
              const proof = document.querySelector(
                '[data-testid="auth-proof-panel"]',
              )
              if (!submit || !proof) return false
              return Boolean(
                submit.compareDocumentPosition(proof) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
              )
            })
            expect(formPrecedesProof).toBe(true)

            if (width <= 900) {
              // AC2/L2: below the breakpoint the card must also come first
              // *visually*, in both directions — the assertion jsdom cannot make.
              const cardAboveProof = await page.evaluate(() => {
                const card = document.querySelector('.auth-card')
                const proof = document.querySelector('.auth-proof-panel')
                if (!card || !proof) return false
                return (
                  card.getBoundingClientRect().top <
                  proof.getBoundingClientRect().top
                )
              })
              expect(cardAboveProof).toBe(true)
            }
          }
        }
      },
    )
  },
)
