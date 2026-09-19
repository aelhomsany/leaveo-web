import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../api/client'
import type { AuthContextValue } from '../auth/useAuth'
import { AuthTestProvider, createMockAuthForRole } from '../test/authTestUtils'
import { mockCalendarMonth } from '../features/calendar/calendarTestFixtures'
import { mockWorkforceGroup } from '../test/apiFixtures'
import { AppRoutes } from './AppRouter'
import { ToastProvider } from '../components/ui/ToastProvider'

vi.mock('../features/my-leaves/MyLeavesPage', () => ({
  MyLeavesPage: () => {
    throw new Error('ATDD: simulated my-leaves render failure')
  },
}))

vi.mock('../features/platform/OrganizationsPage', () => ({
  OrganizationsPage: () => {
    throw new Error('ATDD: simulated organizations render failure')
  },
}))

function renderAppRoutes(
  initialEntries = ['/my-leaves'],
  authValue: AuthContextValue = createMockAuthForRole('EMPLOYEE'),
) {
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

describe('AppRouter route-level error boundary ATDD — Story 10.1', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
      mockWorkforceGroup({ id: 1, name: 'US' }),
    ])
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue([])
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    consoleErrorSpy.mockRestore()
  })

  it(
    '[P0] catches lazy route render errors inside the shell and keeps org chrome interactive',
    async () => {
      renderAppRoutes()

      expect(await screen.findByTestId('route-error-fallback')).toBeInTheDocument()
      expect(screen.getByTestId('org-shell')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    },
  )

})
