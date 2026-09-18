import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import { mockCalendarMonth } from '../../features/calendar/calendarTestFixtures'
import { ToastProvider } from '../../components/ui/ToastProvider'
import {
  AuthTestProvider,
  createMockAuthForRole,
  createMockAuthValue,
} from '../../test/authTestUtils'
import { mockWorkforceGroup } from '../../test/apiFixtures'
import { CustomerRoutes } from './CustomerRouter'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Renders the routes the customer artifact actually ships.
 *
 * WEB-VAL-020's org half was previously proven only against `routes/AppRouter.tsx`,
 * which `app.html` -> `src/entries/customer-main.tsx` never loads: `AppRouter` is
 * imported by its own test files and nothing else, so it is present in no build
 * output. These cases re-anchor that requirement on `CustomerRouter`, the router
 * `app.html` really mounts.
 */
function renderCustomerRoutes(
  initialEntries: string[],
  authValue = createMockAuthForRole('EMPLOYEE'),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <AuthTestProvider value={authValue}>
            <CustomerRoutes />
          </AuthTestProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('CustomerRoutes', () => {
  afterEach(() => {
    document.title = ''
  })

  it('keeps invitation acceptance outside auth guards in the deployed customer router', async () => {
    render(
      <MemoryRouter initialEntries={['/accept-invitation?token=customer-route-token']}>
        <AuthTestProvider
          value={createMockAuthValue({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          })}
        >
          <CustomerRoutes />
        </AuthTestProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('accept-invitation-page')).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(document.title).toBe('Accept invitation — Leaveo')
  })

  it('[P0] renders the real profile page at /profile in the deployed customer router', async () => {
    renderCustomerRoutes(['/profile'])

    expect(await screen.findByTestId('profile-page')).toBeInTheDocument()
    expect(screen.getByTestId('org-shell')).toBeInTheDocument()
    // Positive title assertion: i18n is configured with a parseMissingKeyHandler that
    // returns '', so a broken routes.profile key would render blank rather than throw.
    expect(document.title).toBe('Profile details — Leaveo')
  })

  it('[P1] keeps /profile behind the authentication guard in the deployed customer router', async () => {
    renderCustomerRoutes(
      ['/profile'],
      createMockAuthValue({ user: null, isAuthenticated: false, isLoading: false }),
    )

    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-page')).not.toBeInTheDocument()
  })

  it('[P1] sets the sign-in page title in the deployed customer router', async () => {
    renderCustomerRoutes(
      ['/login'],
      createMockAuthValue({ user: null, isAuthenticated: false, isLoading: false }),
    )

    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(document.title).toBe('Sign in — Leaveo')
  })

  it('[P0] the shipped customer HTML entry carries its own static title', () => {
    // FRONTEND-VAL-005 names `Leaveo — Team Leave Management`, which is index.html — a file
    // vite never builds (inputs are public.html, app.html, admin.html). The shipped customer
    // entry is app.html, so that is what this asserts. Recorded as a requirement-text defect
    // rather than silently reconciled.
    const html = readFileSync(join(repoRoot, 'app.html'), 'utf-8')
    expect(html).toContain('<title>Leaveo — Customer Application</title>')
  })

  it('[P0] redirects a Platform Admin away from org routes in the deployed customer router', async () => {
    renderCustomerRoutes(['/'], createMockAuthForRole('PLATFORM_ADMIN'))

    // Positive landing assertion first: an absence-only check would pass against a blank
    // render. RoleGuard sends PLATFORM_ADMIN to getHomePath('PLATFORM_ADMIN') === '/login'.
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByTestId('team-calendar-page')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('admin-shell')).not.toBeInTheDocument()
  })

  it('[P1] renders the lazy HR policy workspace at its stable draft URL', async () => {
    vi.spyOn(apiClient, 'getPolicySettingsOverview').mockResolvedValue({ leaveTypes: [], users: [], workforceGroups: [] })
    vi.spyOn(apiClient, 'getPolicyDraft').mockResolvedValue({
      policyPublicId: 'policy-1',
      draftPublicId: 'draft-1',
      leaveTypePublicId: 'type-1',
      mode: 'ANNUAL_ALLOWANCE',
      allowanceDays: 20,
      balancePeriod: 'CALENDAR_YEAR',
      scope: 'ORGANIZATION',
      subjectPublicId: '',
      effectiveFrom: '2027-01-01',
      revision: 0,
      consumed: false,
      carryoverEnabled: false,
      carryoverMaxDays: null,
      carryoverDeadlineMonth: null,
      carryoverDeadlineDay: null,
      carryoverRepeat: false,
    })
    vi.spyOn(apiClient, 'getPolicyHistory').mockResolvedValue([])
    renderCustomerRoutes(['/settings/leave-policies/draft-1'], createMockAuthForRole('ORGANIZATION_ADMIN'))
    expect(await screen.findByTestId('policy-settings-page')).toBeInTheDocument()
    expect(document.title).toBe('Policy Settings — Leaveo')
  })

  describe('reports routes', () => {
    it('[P0] renders the lazy report catalog at /reports for an Organization admin', async () => {
      renderCustomerRoutes(['/reports'], createMockAuthForRole('ORGANIZATION_ADMIN'))

      expect(await screen.findByTestId('report-catalog-page')).toBeInTheDocument()
      expect(screen.getByTestId('org-shell')).toBeInTheDocument()
      expect(document.title).toBe('Reports — Leaveo')
    })

    // The workspace moved off /reports so a report can be linked and reloaded; the slug is
    // the only thing that now says which report this is.
    it('[P0] renders the lazy Report Center at a report slug', async () => {
      renderCustomerRoutes(['/reports/carry-over'], createMockAuthForRole('ORGANIZATION_ADMIN'))

      expect(await screen.findByTestId('report-center-page')).toBeInTheDocument()
      expect(screen.getByTestId('org-shell')).toBeInTheDocument()
      expect(document.title).toBe('Reports — Leaveo')
    })

    it('[P0] redirects a manager away from the HR-only reports catalog', async () => {
      renderCustomerRoutes(['/reports'], createMockAuthForRole('MANAGER'))

      // RoleGuard sends forbidden roles to getHomePath — the Team Calendar
      // since the Dashboard merge (2026-09-01).
      expect(
        await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 }),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('report-catalog-page')).not.toBeInTheDocument()
    })

    // The guard matches `/reports` and anything under it. Splitting one route into two made
    // that prefix load-bearing, so a report URL is pinned here too: an unguarded sub-route
    // would hand a manager the HR workspace by typing a slug.
    it('[P0] redirects a manager away from a report URL, not just the catalog', async () => {
      renderCustomerRoutes(['/reports/carry-over'], createMockAuthForRole('MANAGER'))

      expect(
        await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 }),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('report-center-page')).not.toBeInTheDocument()
    })
  })

  describe('team calendar route', () => {
    beforeEach(() => {
      // Pin Date to the calendar fixture month so TeamCalendarPage bootstraps to the
      // fixture month and does not double-fetch (see TeamCalendarPage.test.tsx).
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
      vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
        mockWorkforceGroup({ id: 1, name: 'US' }),
        mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
      ])
      vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([])
      vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('[P0] renders the real Team Calendar page at /calendar in the deployed customer router', async () => {
      renderCustomerRoutes(['/calendar'])

      expect(await screen.findByTestId('team-calendar-page')).toBeInTheDocument()
      expect(screen.getByTestId('org-shell')).toBeInTheDocument()
    })
  })
})
