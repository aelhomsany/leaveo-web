import { test, expect } from '../support/fixtures'
import { tags } from '../support/tags'

const customerCredentials = {
  email: process.env.E2E_USER_EMAIL ?? 'alex@company.com',
  password: process.env.E2E_USER_PASSWORD ?? 'PilotDev123!',
}

const platformAdminCredentials = {
  email: process.env.E2E_PLATFORM_ADMIN_EMAIL ?? 'riley@leaveo.example',
  password: process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? 'PilotDev123!',
}

const apiUrl =
  process.env.API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:8080'
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:4174'

/**
 * Story 12.1 — Public Product Proof and Isolated Entry Boundaries.
 * The public proof runs against the static public artifact. The platform boundary
 * runs with the API-backed application server.
 * Credential/security rules stay in PlatformAuthenticationIsolationIntegrationTest.
 */
test.describe(
  'Public acquisition — Story 12.1',
  { tag: [tags.regression, tags.uiOnly, tags.story('12-1')] },
  () => {
    test.skip(
      process.env.E2E_PUBLIC_ARTIFACT !== 'true',
      'Run with npm run test:e2e:public against the static public artifact',
    )

    test(
      '[P0] Given an indexable public route, When JavaScript is unavailable, Then product evidence, metadata, and navigation remain',
      async ({ page, request, browser }) => {
        // Prefer a JS-disabled context so pre-hydration HTML is authoritative.
        const noJsContext = await browser.newContext({
          javaScriptEnabled: false,
          baseURL: publicBaseUrl,
        })
        const noJsPage = await noJsContext.newPage()
        try {
          let response = await noJsPage.goto(`${publicBaseUrl}/product`)
          if (!response || response.status() >= 400) {
            response = await noJsPage.goto(`${publicBaseUrl}/`)
          }
          expect(response?.ok()).toBeTruthy()

          await expect(noJsPage.getByRole('main')).toBeVisible()
          await expect(noJsPage.getByRole('heading', { level: 1 })).toBeVisible()
          await expect(noJsPage.getByTestId('working-day-proof')).toBeVisible()

          const canonical = noJsPage.locator('link[rel="canonical"]')
          await expect(canonical).toHaveCount(1)
          await expect(canonical.first()).toHaveAttribute('href', /.+/)

          await expect(noJsPage.getByTestId('consent-necessary')).toBeVisible()
        } finally {
          await noJsContext.close()
        }

        // Pre-rendered HTML markers via request.get (works without client hydration).
        const htmlResponse = await request.get('/product')
        const html =
          htmlResponse.ok()
            ? await htmlResponse.text()
            : await (await request.get('/')).text()
        expect(html).toMatch(/data-testid=["']working-day-proof["']/)
        expect(html).toMatch(/rel=["']canonical["']/)
        expect(html).toMatch(/data-testid=["']consent-necessary["']/)

        // Necessary Only → no optional analytics emission.
        await page.goto('/product')
        const analyticsHit = page
          .waitForRequest(
            (req) => req.url().includes('/api/v1/analytics/events'),
            { timeout: 2000 },
          )
          .then(() => true)
          .catch(() => false)

        await expect(page.getByTestId('consent-necessary')).toBeVisible()
        await page.getByTestId('consent-necessary').click()
        expect(await analyticsHit).toBe(false)

        // Unknown public path must be a real HTTP 404 document.
        const notFound = await request.get('/this-route-should-404-public')
        expect(notFound.status()).toBe(404)
        const notFoundBody = await notFound.text()
        expect(notFoundBody).toMatch(/data-testid=["']public-not-found["']|public-not-found/)
      },
    )

    test(
      '[P0] Given mobile, desktop, keyboard, reduced-motion, and Arabic visitors, Then the public proof remains usable and contained',
      async ({ browser, browserName }) => {
        for (const viewport of [
          // 320px and 720px cover the 400% and 200% reflow equivalents.
          { width: 320, height: 844 },
          { width: 390, height: 844 },
          { width: 720, height: 900 },
          { width: 768, height: 900 },
          { width: 900, height: 900 },
          { width: 901, height: 900 },
          { width: 1280, height: 900 },
          { width: 1440, height: 900 },
        ]) {
          const context = await browser.newContext({
            baseURL: publicBaseUrl,
            viewport,
          })
          await context.addInitScript(() => {
            const vitalsWindow = window as typeof window & {
              __publicLabVitals?: { cls: number; inp: number; lcp: number }
            }
            vitalsWindow.__publicLabVitals = { cls: 0, inp: 0, lcp: 0 }
            if (!('PerformanceObserver' in window)) return
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const shift = entry as PerformanceEntry & {
                  hadRecentInput?: boolean
                  value?: number
                }
                if (!shift.hadRecentInput) {
                  vitalsWindow.__publicLabVitals!.cls += shift.value ?? 0
                }
              }
            }).observe({ type: 'layout-shift', buffered: true })
            new PerformanceObserver((list) => {
              const last = list.getEntries().at(-1)
              if (last) vitalsWindow.__publicLabVitals!.lcp = last.startTime
            }).observe({ type: 'largest-contentful-paint', buffered: true })
            // The cast is for durationThreshold, Event Timing's own option, which TypeScript's DOM lib
            // does not declare yet.
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const interaction = entry as PerformanceEntry & {
                  duration?: number
                  interactionId?: number
                }
                if ((interaction.interactionId ?? 0) > 0) {
                  vitalsWindow.__publicLabVitals!.inp = Math.max(
                    vitalsWindow.__publicLabVitals!.inp,
                    interaction.duration ?? 0,
                  )
                }
              }
            }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit)
          })
          const page = await context.newPage()
          await page.goto('/product')
          await expect(page.getByTestId('working-day-proof')).toBeVisible()
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          ).toBe(true)
          await page.getByRole('button', { name: 'Close Privacy Choices' }).click()
          await page.waitForTimeout(150)
          const labVitals = await page.evaluate(
            () =>
              (
                window as typeof window & {
                  __publicLabVitals: { cls: number; inp: number; lcp: number }
                }
              ).__publicLabVitals,
          )
          // Lab budgets, deliberately NOT AC5's field thresholds. AC5 states its
          // targets as p75 of real user traffic segmented by device class, and
          // requires that lab results are not misrepresented as field p75 — a single
          // headless run on one machine cannot measure a percentile. These are
          // regression tripwires: a static, pre-rendered document with a bounded
          // bundle should land far inside the field targets, so a breach means
          // something structural regressed (an unbounded chunk, a layout shift, a
          // blocking script). The real p75 gate is the consented field Web Vitals
          // measurement, tracked separately as deferred work.
          const LAB_LCP_BUDGET_MS = 2_000
          const LAB_INP_BUDGET_MS = 160
          const LAB_CLS_BUDGET = 0.05
          expect(labVitals.lcp).toBeGreaterThan(0)
          expect(labVitals.lcp).toBeLessThanOrEqual(LAB_LCP_BUDGET_MS)
          expect(labVitals.inp).toBeLessThanOrEqual(LAB_INP_BUDGET_MS)
          expect(labVitals.cls).toBeLessThanOrEqual(LAB_CLS_BUDGET)
          await context.close()
        }

        const keyboardContext = await browser.newContext({ baseURL: publicBaseUrl })
        const keyboardPage = await keyboardContext.newPage()
        await keyboardPage.goto('/product')
        await keyboardPage.keyboard.press(
          browserName === 'webkit' ? 'Alt+Tab' : 'Tab',
        )
        await expect(
          keyboardPage.getByRole('link', { name: 'Skip to main content' }),
        ).toBeFocused()
        await keyboardPage.keyboard.press('Enter')
        await expect(keyboardPage.locator('#public-main')).toBeFocused()
        await keyboardContext.close()

        const reducedContext = await browser.newContext({
          baseURL: publicBaseUrl,
          reducedMotion: 'reduce',
        })
        const reducedPage = await reducedContext.newPage()
        await reducedPage.goto('/product')
        const reducedMotion = await reducedPage.evaluate(() => ({
          matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
          transitionDuration: getComputedStyle(
            document.querySelector('.btn') as HTMLElement,
          ).transitionDuration,
        }))
        expect(reducedMotion.matches).toBe(true)
        expect(parseFloat(reducedMotion.transitionDuration)).toBeLessThanOrEqual(0.01)
        await reducedContext.close()

        const arabicContext = await browser.newContext({
          baseURL: publicBaseUrl,
          viewport: { width: 390, height: 844 },
        })
        const arabicPage = await arabicContext.newPage()
        await arabicPage.goto('/ar/product')
        await expect(arabicPage.locator('html')).toHaveAttribute('lang', 'ar')
        await expect(arabicPage.locator('html')).toHaveAttribute('dir', 'rtl')
        await expect(arabicPage.getByTestId('working-day-proof')).toBeVisible()
        expect(
          await arabicPage.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true)
        expect(
          await arabicPage.getByTestId('proof-dates').evaluate(
            (element) => getComputedStyle(element).direction,
          ),
        ).toBe('ltr')
        await arabicContext.close()
      },
    )
  },
)

test.describe(
  'Platform Admin boundary — Story 12.1',
  { tag: [tags.smoke, tags.regression, tags.api, tags.story('12-1')] },
  () => {
    test.skip(
      process.env.E2E_API_AVAILABLE !== 'true',
      'Set E2E_API_AVAILABLE=true when leaveo-api is running with platform-auth seed',
    )
    test(
      '[P0] Given customer and Platform Admin credentials, When each is used in both realms, Then only its own realm accepts it',
      async ({ page, request }) => {
        await page.goto('/app-admin/login')
        await expect(page.getByTestId('platform-sign-in-email')).toBeVisible()
        await expect(page.getByTestId('platform-sign-in-password')).toBeVisible()
        await expect(page.getByTestId('platform-sign-in-submit')).toBeVisible()

        // Platform success → operator shell only (no org nav).
        await page.getByTestId('platform-sign-in-email').fill(
          platformAdminCredentials.email,
        )
        await page.getByTestId('platform-sign-in-password').fill(
          platformAdminCredentials.password,
        )
        await page.getByTestId('platform-sign-in-submit').click()

        await expect(page).toHaveURL(/\/app-admin\/organizations/)
        await expect(page.getByTestId('admin-shell')).toBeVisible()
        await expect(page.getByTestId('nav-calendar')).toHaveCount(0)
        // Sign-out moved into the header user menu (WEB-VAL-020); the panel renders
        // only while open, so the trigger has to be clicked first.
        await page.getByTestId('user-menu-trigger').click()
        await page.getByTestId('user-menu-item-sign-out').click()
        await expect(page).toHaveURL(/\/app-admin\/login/)

        // Platform credentials at customer /login fail neutrally.
        await page.goto('/login')
        await page.getByTestId('sign-in-email').fill(platformAdminCredentials.email)
        await page.getByTestId('sign-in-password').fill(
          platformAdminCredentials.password,
        )
        await page.getByTestId('sign-in-submit').click()

        await expect(page).toHaveURL(/\/login/)
        await expect(page.getByRole('alert')).toBeVisible()
        await expect(page.getByTestId('admin-shell')).toHaveCount(0)

        // Customer credentials at /app-admin/login fail neutrally.
        await page.goto('/app-admin/login')
        await page.getByTestId('platform-sign-in-email').fill(
          customerCredentials.email,
        )
        await page.getByTestId('platform-sign-in-password').fill(
          customerCredentials.password,
        )
        await page.getByTestId('platform-sign-in-submit').click()

        await expect(page).toHaveURL(/\/app-admin\/login/)
        await expect(page.getByRole('alert')).toBeVisible()
        await expect(page.getByTestId('admin-shell')).toHaveCount(0)

        // Wrong-realm token cannot call Platform APIs.
        const customerLogin = await request.post(`${apiUrl}/api/v1/auth/login`, {
          data: {
            email: customerCredentials.email,
            password: customerCredentials.password,
            // Africa/Cairo matches how this account is seeded. Login persists the timezone it is
            // given, so a differing value rewrote the row on every call — toggling it against the
            // browser sign-ins other specs make as the same user, and deadlocking (MySQL 1213) on
            // that row. This test is about realm isolation, not timezone capture.
            timezone: 'Africa/Cairo',
          },
        })
        expect(customerLogin.ok()).toBeTruthy()
        const { accessToken } = await customerLogin.json()
        const platformDenied = await request.get(
          `${apiUrl}/api/v1/platform/organizations`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        expect([401, 403]).toContain(platformDenied.status())
      },
    )
  },
)
