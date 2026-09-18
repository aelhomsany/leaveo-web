import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
// The Dashboard merged into My Leaves (2026-09-01); MyLeavesPage owns the
// greeting the shell typography test asserts on.
import { MyLeavesPage } from '../../features/my-leaves/MyLeavesPage'
import {
  AuthTestProvider,
  createMockAuthForRole,
  createMockAuthValue,
  mockUsers,
} from '../../test/authTestUtils'
import { ToastProvider } from '../ui/ToastProvider'
import { OrgShell } from './OrgShell'

function renderOrgShell(
  role: Parameters<typeof createMockAuthForRole>[0],
  serverCapability = role === 'MANAGER' || role === 'ORGANIZATION_ADMIN',
) {
  vi.mocked(apiClient.getApprovalCapability).mockResolvedValue({
    canReviewApprovals: serverCapability,
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/']}>
            <AuthTestProvider value={createMockAuthForRole(role)}>
              <Routes>
                <Route element={<OrgShell />}>
                  <Route path="/" element={<MyLeavesPage />} />
                </Route>
              </Routes>
            </AuthTestProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  }
}

describe('OrgShell', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getApprovalCapability').mockResolvedValue({
      canReviewApprovals: false,
    })
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([])
    vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 0 })
    // Plan VUELTA: an Organization Admin's badge sums both queues, so the cancellation
    // count is part of every render that resolves it.
    vi.spyOn(apiClient, 'getPendingCancellationCount').mockResolvedValue({ count: 0 })
    vi.spyOn(apiClient, 'getUnreadNotificationCount').mockResolvedValue({ count: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders teal sidebar and dashboard greeting typography', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/']}>
            <AuthTestProvider>
              <Routes>
                <Route element={<OrgShell />}>
                  <Route path="/" element={<MyLeavesPage />} />
                </Route>
              </Routes>
            </AuthTestProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveClass('sidebar', 'sidebar--org')
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument()

    const pageTitle = screen.getByRole('heading', { name: /Good (morning|afternoon|evening)/i })
    expect(pageTitle).toHaveClass('page-title')
  })

  it('shows only base nav items for EMPLOYEE', () => {
    renderOrgShell('EMPLOYEE')

    expect(screen.getByTestId('nav-calendar')).toBeInTheDocument()
    expect(screen.getByTestId('nav-my-leaves')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-approvals')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-settings')).not.toBeInTheDocument()
  })

  it('shows Approvals for MANAGER without Settings', () => {
    renderOrgShell('MANAGER')

    expect(screen.getByTestId('nav-approvals')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-settings')).not.toBeInTheDocument()
  })

  it('shows Approvals for an assigned EMPLOYEE after capability refresh', async () => {
    renderOrgShell('EMPLOYEE', true)

    expect(await screen.findByTestId('nav-approvals')).toBeInTheDocument()
  })

  it('shows Approvals and Settings for ORGANIZATION_ADMIN', () => {
    renderOrgShell('ORGANIZATION_ADMIN')

    expect(screen.getByTestId('nav-approvals')).toBeInTheDocument()
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument()
  })

  it('shows no org nav items for PLATFORM_ADMIN fallback role', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/']}>
            <AuthTestProvider value={createMockAuthForRole('PLATFORM_ADMIN')}>
              <Routes>
                <Route element={<OrgShell />}>
                  <Route path="/" element={<MyLeavesPage />} />
                </Route>
              </Routes>
            </AuthTestProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    expect(screen.queryByTestId('nav-calendar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-approvals')).not.toBeInTheDocument()
  })

  it('[P0] renders Approvals badge with scoped pending count for Manager', async () => {
    vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 2 })

    renderOrgShell('MANAGER')

    expect(await screen.findByTestId('nav-approvals-badge')).toHaveTextContent('2')
    expect(screen.getByTestId('nav-approvals')).toHaveAttribute('aria-label', 'Approvals, 2 pending')
  })

  it('[P0] hides the Approvals badge when the scoped pending count is zero', async () => {
    vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 0 })

    renderOrgShell('MANAGER')

    expect(await screen.findByTestId('nav-approvals')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-approvals-badge')).not.toBeInTheDocument()
  })

  it('[P0] does not query pending count and never renders Approvals nav for Employee', () => {
    const countSpy = vi.spyOn(apiClient, 'getPendingApprovalCount')

    renderOrgShell('EMPLOYEE')

    expect(countSpy).not.toHaveBeenCalled()
    expect(screen.queryByTestId('nav-approvals')).not.toBeInTheDocument()
  })

  it('[P0] hides Approvals badge after pending-count refetch returns zero', async () => {
    vi.spyOn(apiClient, 'getPendingApprovalCount')
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValue({ count: 0 })

    const { queryClient } = renderOrgShell('MANAGER')

    expect(await screen.findByTestId('nav-approvals-badge')).toHaveTextContent('2')
    await queryClient.invalidateQueries({ queryKey: ['approvals', 'pending-count', 1] })

    await waitFor(() => {
      expect(screen.queryByTestId('nav-approvals-badge')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('nav-approvals')).toHaveAttribute('aria-label', 'Approvals')
  })

  it('[P0] renders notification bell in the app header, not the sidebar', async () => {
    renderOrgShell('EMPLOYEE')

    const header = screen.getByTestId('app-header')
    expect(header).toContainElement(await screen.findByTestId('notification-bell'))

    const sidebar = screen.getByTestId('sidebar')
    expect(within(sidebar).queryByTestId('notification-bell')).toBeNull()
    expect(sidebar.querySelector('.sidebar-logo')).toBeInTheDocument()
    expect(within(sidebar).getByRole('img', { name: 'Leaveo' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument()
  })

  it('[P1] orders language switcher before notification bell and user menu', async () => {
    renderOrgShell('EMPLOYEE')
    const actions = screen.getByTestId('app-header').querySelector('.app-header-actions')!
    expect(Array.from(actions.children).map((child) => child.getAttribute('data-testid') ?? child.querySelector('[data-testid]')?.getAttribute('data-testid'))).toEqual([
      'language-switcher',
      'notification-bell',
      'user-menu-trigger',
    ])
  })

  it('[P1] places the mobile language control inside the user menu', async () => {
    renderOrgShell('EMPLOYEE')
    await userEvent.click(await screen.findByTestId('user-menu-trigger'))
    expect(screen.getByTestId('mobile-language-switcher')).toBeInTheDocument()
  })

  it('[P2] renders shell navigation labels through the translation layer', async () => {
    renderOrgShell('EMPLOYEE')

    // layout:nav.calendar, not the rolePermissions fallback label.
    expect(screen.getByTestId('nav-calendar')).toHaveTextContent('Calendar')
    await userEvent.click(await screen.findByTestId('user-menu-trigger'))
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('[P1] shows the organization name in the app header with full-name tooltip', () => {
    renderOrgShell('EMPLOYEE')

    const context = screen.getByTestId('app-header-context')
    expect(context).toHaveTextContent('Nile Harbor')
    expect(context).toHaveAttribute('title', 'Nile Harbor')
  })

  it('[P0] renders user menu in the header and removes sidebar sign-out', async () => {
    renderOrgShell('EMPLOYEE')

    const header = screen.getByTestId('app-header')
    expect(header).toContainElement(await screen.findByTestId('user-menu-trigger'))

    const sidebar = screen.getByTestId('sidebar')
    expect(within(sidebar).queryByTestId('sign-out-button')).not.toBeInTheDocument()
    expect(within(sidebar).queryByText('Sign out')).not.toBeInTheDocument()
  })

  it('[P1] opening the user menu closes an already-open notification panel', async () => {
    renderOrgShell('EMPLOYEE')

    await userEvent.click(await screen.findByTestId('notification-bell'))
    expect(screen.getByTestId('notification-bell')).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(screen.getByTestId('user-menu-trigger'))
    expect(screen.getByTestId('user-menu-panel')).toBeInTheDocument()
    expect(screen.getByTestId('notification-bell')).toHaveAttribute('aria-expanded', 'false')

    await waitFor(() => {
      expect(screen.getByTestId('user-menu-trigger')).toHaveFocus()
    })
  })

  it('[P0] shows profile image in the header avatar when profileImageUrl is present', async () => {
    vi.spyOn(apiClient, 'getProfileImageContent').mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:profile'), revokeObjectURL: vi.fn() })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/']}>
            <AuthTestProvider
              value={createMockAuthValue({
                user: {
                  ...mockUsers.employee,
                  profileImageUrl: '/api/v1/users/me/profile-image/content?v=1',
                },
              })}
            >
              <Routes>
                <Route element={<OrgShell />}>
                  <Route path="/" element={<MyLeavesPage />} />
                </Route>
              </Routes>
            </AuthTestProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('user-menu-trigger').querySelector('img')).toBeInTheDocument()
    })
  })
  /**
   * The Reports nav item is gated on a live capability probe, but nothing tested that OrgShell
   * actually supplies the probe result: rolePermissions.test.ts passes its own booleans, and no
   * shell or E2E test looked for nav-reports at all. Dropping the argument would have shown every
   * Organization administrator a link straight to a denial banner.
   */
  describe('reports nav capability probe', () => {
    it('shows Reports when the plan entitles the workspace', async () => {
      vi.spyOn(apiClient, 'getCapabilityAccess').mockResolvedValue({
        capability: 'ADVANCED_REPORTING',
        availability: 'AVAILABLE',
        allowed: true,
      })
      renderOrgShell('ORGANIZATION_ADMIN')

      expect(await screen.findByTestId('nav-reports')).toBeInTheDocument()
    })

    it('hides Reports when the gate denies and there is nothing to recover', async () => {
      vi.spyOn(apiClient, 'getCapabilityAccess').mockRejectedValue(
        new apiClient.ApiError(403, { title: 'Forbidden', detail: 'Not entitled' }),
      )
      vi.spyOn(apiClient, 'listReportExports').mockResolvedValue([])
      renderOrgShell('ORGANIZATION_ADMIN')

      await screen.findByTestId('nav-calendar')
      await waitFor(() => {
        expect(screen.queryByTestId('nav-reports')).toBeNull()
      })
    })

    it('keeps Reports reachable under restricted billing when exports remain', async () => {
      // AC3: billing is restricted, so the capability gate denies - but exports created earlier
      // are still collectable, and hiding the entry point made that unreachable.
      vi.spyOn(apiClient, 'getCapabilityAccess').mockRejectedValue(
        new apiClient.ApiError(403, { title: 'Forbidden', detail: 'Not entitled' }),
      )
      vi.spyOn(apiClient, 'listReportExports').mockResolvedValue([
        { id: 'export-1', status: 'READY' } as never,
      ])
      renderOrgShell('ORGANIZATION_ADMIN')

      expect(await screen.findByTestId('nav-reports')).toBeInTheDocument()
    })
  })
})
