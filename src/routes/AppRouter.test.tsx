import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import * as apiClient from '../api/client'
import {
  AuthTestProvider,
  createMockAuthForRole,
  createMockAuthValue,
} from '../test/authTestUtils'
import { AppRoutes } from './AppRouter'
import { mockCalendarMonth } from '../features/calendar/calendarTestFixtures'
import { mockWorkforceGroup } from '../test/apiFixtures'
import { ToastProvider } from '../components/ui/ToastProvider'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const indexHtmlPath = join(repoRoot, 'index.html')

function renderAppRoutes(initialEntries: string[], authValue = createMockAuthForRole('EMPLOYEE')) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <AuthTestProvider value={authValue}>
            <AppRoutes />
          </AuthTestProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('AppRoutes', () => {
  beforeEach(() => {
    // Pin Date to the calendar fixture month (June 2026) so TeamCalendarPage
    // bootstraps to the fixture month and does not double-fetch (see
    // TeamCalendarPage.test.tsx for details). Only Date is faked.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
      mockWorkforceGroup({ id: 1, name: 'US' }),
      mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
    ])
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue([])
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    vi.spyOn(apiClient, 'getPlatformOrganizations').mockResolvedValue([])
  })

  afterEach(() => {
    document.title = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('redirects unauthenticated users from root to login', async () => {
    renderAppRoutes(
      ['/'],
      createMockAuthValue({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
  })

  it('redirects the root route to the team calendar when authenticated', async () => {
    // The Dashboard merged into /my-leaves (2026-09-01); '/' stays as a
    // bookmark-preserving redirect to the calendar landing page.
    renderAppRoutes(['/'], createMockAuthForRole('EMPLOYEE'))

    // Pages are lazy-loaded, so wait for the chunk to resolve.
    expect(
      await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('org-shell')).toBeInTheDocument()
    expect(screen.getByTestId('nav-calendar')).toBeInTheDocument()
  })

  // Story 12.1 moved the Platform Admin console out of the customer artifact. The
  // customer router must not serve /platform/* at all, and must never mount the
  // admin shell — that is the boundary the split exists to create.
  it('serves no platform route and never mounts the admin shell', async () => {
    renderAppRoutes(['/platform/organizations'], createMockAuthForRole('MANAGER'))

    await waitFor(() => {
      expect(screen.queryByTestId('admin-shell')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Organizations' })).not.toBeInTheDocument()
  })

  it('keeps a platform admin out of the org shell', async () => {
    renderAppRoutes(['/'], createMockAuthForRole('PLATFORM_ADMIN'))

    await waitFor(() => {
      expect(screen.queryByTestId('team-calendar-page')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('admin-shell')).not.toBeInTheDocument()
  })

  it('redirects employee from settings route', async () => {
    renderAppRoutes(['/settings'], createMockAuthForRole('EMPLOYEE'))

    expect(
      await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Organization Settings' })).not.toBeInTheDocument()
  })

  it('redirects employee from approvals route', async () => {
    renderAppRoutes(['/approvals'], createMockAuthForRole('EMPLOYEE'))

    expect(
      await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Approvals' })).not.toBeInTheDocument()
  })

  it('redirects manager from settings route', async () => {
    renderAppRoutes(['/settings'], createMockAuthForRole('MANAGER'))

    expect(
      await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Organization Settings' })).not.toBeInTheDocument()
  })

  it('allows Organization admin to open settings route', async () => {
    renderAppRoutes(['/settings'], createMockAuthForRole('ORGANIZATION_ADMIN'))

    expect(await screen.findByRole('heading', { name: 'Organization Settings' })).toBeInTheDocument()
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument()
  })

  it('renders the real Team Calendar page at /calendar', async () => {
    renderAppRoutes(['/calendar'], createMockAuthForRole('EMPLOYEE'))

    // Lazy page chunk + server-date reconciliation can exceed the default 1s
    // findBy timeout under parallel test load.
    expect(
      await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(
      await screen.findByTestId('calendar-timeline', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Org-wide leave coverage and holidays')).toBeInTheDocument()
  })

  it('renders org shell Page Not Found for unknown routes when authenticated', () => {
    renderAppRoutes(['/unknown-page'], createMockAuthForRole('EMPLOYEE'))

    expect(screen.getByTestId('org-shell')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Page Not Found' })).toBeInTheDocument()
  })

  it('sets the team calendar page title on the root redirect', async () => {
    renderAppRoutes(['/'], createMockAuthForRole('EMPLOYEE'))

    await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 })
    expect(document.title).toBe('Team Calendar — Leaveo')
  })

  it('sets the settings page title', async () => {
    renderAppRoutes(['/settings'], createMockAuthForRole('ORGANIZATION_ADMIN'))

    await screen.findByRole('heading', { name: 'Organization Settings' })
    expect(document.title).toBe('Organization Settings — Leaveo')
  })

  it('sets the login page title', async () => {
    renderAppRoutes(
      ['/login'],
      createMockAuthValue({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      }),
    )

    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(document.title).toBe('Sign in — Leaveo')
  })

  it('renders invitation acceptance publicly for a logged-out invitee and sets its title', async () => {
    renderAppRoutes(
      ['/accept-invitation?token=route-token'],
      createMockAuthValue({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      }),
    )

    expect(await screen.findByTestId('accept-invitation-page')).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(document.title).toBe('Accept invitation — Leaveo')
  })

  it('uses the static product title before React boots', () => {
    const html = readFileSync(indexHtmlPath, 'utf-8')
    expect(html).toContain('<title>Leaveo — Team Leave Management</title>')
  })

  it('[P0] renders the real profile page in the org shell', async () => {
    renderAppRoutes(['/profile'], createMockAuthForRole('EMPLOYEE'))

    expect(await screen.findByTestId('profile-page')).toBeInTheDocument()
    expect(screen.getByTestId('org-shell')).toBeInTheDocument()
  })

})
