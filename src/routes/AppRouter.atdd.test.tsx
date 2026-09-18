import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../api/client'
import {
  AuthTestProvider,
  createMockAuthForRole,
  createMockAuthValue,
} from '../test/authTestUtils'
import { mockCalendarMonth } from '../features/calendar/calendarTestFixtures'
import { AppRoutes } from './AppRouter'
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

describe('AppRouter page identity ATDD — Story 10.1', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
      { id: 1, name: 'US', weekendDays: ['SATURDAY', 'SUNDAY'] },
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

  it(
    '[P0] sets document.title to "{Page title} — Leaveo" on the root route',
    async () => {
      // '/' redirects to the Team Calendar landing page since the Dashboard
      // merge (2026-09-01).
      renderAppRoutes(['/'], createMockAuthForRole('EMPLOYEE'))

      await screen.findByTestId('team-calendar-page', undefined, { timeout: 3000 })
      // usePageTitle runs in a router-level effect that commits after the page's
      // testid is queryable, so poll rather than read document.title synchronously:
      // under full-suite load the effect can lag findByTestId and read the '' an
      // earlier afterEach left behind.
      await expect.poll(() => document.title).toBe('Team Calendar — Leaveo')
    },
  )

  it(
    '[P0] sets document.title to "{Page title} — Leaveo" on the settings route',
    async () => {
      renderAppRoutes(['/settings'], createMockAuthForRole('ORGANIZATION_ADMIN'))

      await screen.findByRole('heading', { name: 'Organization Settings' })
      await expect.poll(() => document.title).toBe('Organization Settings — Leaveo')
    },
  )

  it(
    '[P0] sets document.title to "{Page title} — Leaveo" on the login route',
    async () => {
      renderAppRoutes(
        ['/login'],
        createMockAuthValue({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        }),
      )

      expect(await screen.findByTestId('login-page')).toBeInTheDocument()
      await expect.poll(() => document.title).toBe('Sign in — Leaveo')
    },
  )


  it(
    '[P0] index.html exposes the static product title before React boots',
    () => {
      const html = readFileSync(indexHtmlPath, 'utf-8')
      expect(html).toContain('<title>Leaveo — Team Leave Management</title>')
    },
  )
})

describe('AppRouter profile route ATDD — Story 9.3', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
      { id: 1, name: 'US', weekendDays: ['SATURDAY', 'SUNDAY'] },
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

  it('[P0] renders the real profile page in the org shell instead of the 9.2 placeholder', async () => {
    renderAppRoutes(['/profile'], createMockAuthForRole('EMPLOYEE'))

    expect(await screen.findByTestId('profile-page')).toBeInTheDocument()
    expect(screen.getByTestId('org-shell')).toBeInTheDocument()
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument()
  })

})
