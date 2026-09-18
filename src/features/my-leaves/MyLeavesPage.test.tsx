import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isolate } from '../../i18n/bidi'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type {
  BalanceCardResponse,
  LeaveTypeResponse,
  OutTodayResponse,
  PreviewLeaveRequestResponse,
  RecentRequestResponse,
  UpcomingAbsenceResponse,
  UserRole,
} from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { ToastProvider } from '../../components/ui/ToastProvider'
import i18n from '../../i18n/config'
import { MyLeavesPage } from './MyLeavesPage'

const mockBalances: BalanceCardResponse[] = [
  {
    leaveTypeId: 1,
    name: 'Annual Leave',
    icon: 'leave',
    color: '#093C5D',
    backgroundColor: '#D6E8ED',
    borderColor: '#0E4F75',
    displayOrder: 1,
    capped: true,
    allocatedDays: 20,
    usedDays: 5,
    remainingDays: 15,
  },
  {
    leaveTypeId: 5,
    name: 'Unpaid Leave',
    icon: 'unpaid',
    color: '#5A7A80',
    backgroundColor: '#ECF4E8',
    borderColor: '#B8DCC4',
    displayOrder: 5,
    capped: false,
    allocatedDays: null,
    usedDays: 0,
    remainingDays: null,
  },
]

const mockHistory: RecentRequestResponse[] = [
  {
    id: 3,
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-05',
    workingDays: 3,
    status: 'APPROVED',
    statusHint: 'Approved by Alex',
    declineReason: null,
    approverFirstName: 'Alex',
  },
  {
    id: 2,
    leaveTypeId: 2,
    leaveTypeName: 'Sick Leave',
    leaveTypeIcon: 'sick',
    leaveTypeColor: '#991B1B',
    leaveTypeBackgroundColor: '#FEE2E2',
    leaveTypeBorderColor: '#FECACA',
    dateFrom: '2026-06-12',
    dateTo: '2026-06-12',
    workingDays: 1,
    status: 'DECLINED',
    statusHint: null,
    declineReason: 'Team needs in-office coverage for sprint review',
    approverFirstName: null,
  },
  {
    id: 1,
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-06-10',
    dateTo: '2026-06-14',
    workingDays: 3,
    status: 'PENDING',
    statusHint: 'Waiting for approval',
    declineReason: null,
    approverFirstName: null,
  },
]

const mockLeaveTypes: LeaveTypeResponse[] = [
  {
    id: 1,
    name: 'Annual Leave',
    icon: 'leave',
    color: '#093C5D',
    backgroundColor: '#D6E8ED',
    borderColor: '#0E4F75',
    defaultBalanceDays: 20,
    displayOrder: 1,
  },
]

const mockPreview: PreviewLeaveRequestResponse = {
  workingDays: 5,
  chargedDays: 5,
  excludedWeekends: 2,
  excludedHolidays: 0,
  workforceGroupId: 1,
  workforceGroupName: 'US',
}

const mockCreateResponse = {
  id: 99,
  leaveTypeId: 1,
  dateFrom: '2026-08-03',
  dateTo: '2026-08-07',
  days: 5,
  status: 'PENDING' as const,
  note: null,
  createdAt: '2026-06-13T10:00:00Z',
}

function renderMyLeavesPage(
  initialPath = '/my-leaves',
  role: UserRole = 'EMPLOYEE',
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthTestProvider value={createMockAuthForRole(role)}>
            <MyLeavesPage />
          </AuthTestProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

async function setLeaveDates(from: string, to: string) {
  fireEvent.change(screen.getByTestId('leave-from-date'), { target: { value: from } })
  fireEvent.change(screen.getByTestId('leave-to-date'), { target: { value: to } })
  await waitFor(() => {
    expect(screen.getByTestId('leave-from-date')).toHaveValue(from)
    expect(screen.getByTestId('leave-to-date')).toHaveValue(to)
  })
}

describe('MyLeavesPage', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    if (i18n.language !== 'en') {
      await act(() => i18n.changeLanguage('en'))
    }
  })

  it('[P1] announces balance and history loading via role=status', () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockImplementation(
      () => new Promise(() => undefined),
    )
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockImplementation(
      () => new Promise(() => undefined),
    )

    renderMyLeavesPage()

    expect(
      screen.getByRole('status', { name: /loading leave balances/i }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(
      screen.getByRole('status', { name: /loading leave history/i }),
    ).toHaveAttribute('aria-busy', 'true')
  })

  it('[P1] keeps balance and history errors adjacent and retries each region', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances')
      .mockRejectedValueOnce(new Error('balances unavailable'))
      .mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests')
      .mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValue(mockHistory)
    const user = userEvent.setup()

    renderMyLeavesPage()

    const balancesError = await screen.findByTestId('my-leaves-balances-error')
    const historyError = await screen.findByTestId('my-leaves-history-error')
    expect(within(balancesError).getByRole('alert')).toHaveTextContent(
      'Unable to load your leave balances',
    )
    expect(within(historyError).getByRole('alert')).toHaveTextContent(
      'Unable to load your leave history',
    )

    await user.click(within(balancesError).getByRole('button', { name: 'Retry' }))
    await user.click(within(historyError).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('my-leaves-balance-grid')).toBeInTheDocument()
    expect(await screen.findByTestId('my-leaves-request-row-3')).toBeInTheDocument()
  })

  it('renders the page full-bleed (page-wide) like Settings', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    expect(screen.getByTestId('my-leaves-page')).toHaveClass('page', 'page-wide')
  })

  it('[P0] renders attention, balances, filters, history, and support rail in task order', async () => {
    // The stored-result explainer dissolved into the support rail when the
    // Dashboard merged into My Leaves (2026-09-01); the rail now closes the order.
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    const balanceGrid = await screen.findByTestId('my-leaves-balance-grid')
    const attention = screen.getByTestId('my-leaves-attention')
    const filters = screen.getByTestId('my-leaves-status-filter')
    const historyTable = await screen.findByTestId('my-leaves-history-table')
    const rail = screen.getByTestId('my-leaves-support-rail')
    expect(attention.compareDocumentPosition(balanceGrid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(balanceGrid.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(filters.compareDocumentPosition(historyTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(historyTable.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('[P0] derives every rail figure from the feeds the page already fetches', async () => {
    // Each number below is traceable to a mocked API response — one OFF and one
    // WFH entry in the out-today feed, two upcoming rows, and mockHistory[0]'s
    // workingDays for the latest-request line. No client-side summing of
    // server-counted values.
    const outToday: OutTodayResponse[] = [
      { userId: 11, fullName: 'Omar Fields', initials: 'OF', presence: 'OFF', leaveTypeName: 'Annual Leave' },
      { userId: 12, fullName: 'Lena Waters', initials: 'LW', presence: 'WFH', leaveTypeName: 'Work From Home' },
    ]
    const upcoming: UpcomingAbsenceResponse[] = [
      { id: 41, userId: 11, fullName: 'Omar Fields', dateFrom: '2026-07-20', workingDays: 2 },
      { id: 42, userId: 13, fullName: 'Sara Novak', dateFrom: '2026-07-22', workingDays: 5 },
    ]
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue(outToday)
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue(upcoming)

    renderMyLeavesPage()

    const rail = screen.getByTestId('my-leaves-support-rail')
    await waitFor(() => {
      expect(within(rail).getByTestId('my-leaves-rail-off-today')).toHaveTextContent(/^1$/)
    })
    expect(within(rail).getByTestId('my-leaves-rail-wfh-today')).toHaveTextContent(/^1$/)
    expect(within(rail).getByTestId('my-leaves-rail-upcoming-count')).toHaveTextContent(/^2$/)
    // mockHistory[0] (id 3) is the latest request: workingDays 3.
    expect(within(rail).getByTestId('my-leaves-rail-working-days')).toHaveTextContent('3 working days')
    expect(within(rail).getByText('Omar Fields')).toBeInTheDocument()
    expect(within(rail).getByText('Sara Novak')).toBeInTheDocument()
  })

  it('[P1] falls back to redacted copy for privacy-projected upcoming rows', async () => {
    // PRIV-UI-VAL-004 (Story 16.2): identity and leaveTypeIcon are projected away
    // for viewers who may not see them. The name falls back to real copy and the
    // decorative icon element is dropped rather than rendered empty.
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([
      { id: 41, userId: 11, dateFrom: '2026-07-20', workingDays: 2 },
    ] satisfies UpcomingAbsenceResponse[])

    renderMyLeavesPage()

    const rail = screen.getByTestId('my-leaves-support-rail')
    expect(await within(rail).findByText('A teammate')).toBeInTheDocument()
    expect(rail.querySelector('.upcoming-icon')).toBeNull()
  })

  it('[P1] renders mirrored balance grid and full personal history', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    await waitFor(() => {
      expect(screen.getByTestId('my-leaves-balance-grid')).toBeInTheDocument()
    })

    expect(screen.getByTestId('balance-card-annual-leave')).toBeInTheDocument()
    expect(screen.getByTestId('balance-card-unpaid-leave')).toBeInTheDocument()
    const historyRegion = screen.getByRole('region', { name: 'Leave History' })
    expect(historyRegion).toBe(screen.getByTestId('my-leaves-history-table'))
    expect(historyRegion).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('my-leaves-request-row-3')).toHaveTextContent('Approved')
    expect(screen.getByTestId('my-leaves-request-row-2')).toHaveTextContent('Declined')
    expect(screen.getByTestId('my-leaves-request-row-1')).toHaveTextContent('Pending')
  })

  it('[P1] renders ordered approval evidence in personal history', async () => {
    const historyWithEvidence: RecentRequestResponse[] = [{
      ...mockHistory[0],
      approvalEvidence: [
        {
          level: 1,
          nominalApproverId: 3,
          nominalApproverFullName: 'Alex Manager',
          status: 'APPROVED',
          result: 'APPROVED',
          current: false,
          actedOnBehalf: false,
          actualActorId: 3,
          actualActorFullName: 'Alex Manager',
          decidedAt: '2026-07-01T10:00:00Z',
        },
        {
          level: 2,
          nominalApproverId: 7,
          nominalApproverFullName: 'Parker PM',
          status: 'CONCERN_RECORDED',
          result: 'CONCERN_RECORDED',
          current: false,
          actedOnBehalf: true,
          actualActorId: 9,
          actualActorFullName: 'Harper HR',
          note: 'Project coverage was discussed',
          decidedAt: '2026-07-01T11:00:00Z',
        },
      ],
    }]
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(historyWithEvidence)
    const user = userEvent.setup()

    renderMyLeavesPage()

    const row = await screen.findByTestId('my-leaves-request-row-3')
    await user.click(within(row).getByRole('button', { name: /Details for Annual Leave/i }))

    const details = await screen.findByTestId('my-leaves-request-details-3')
    const progress = within(details).getByTestId('approval-progress')
    const steps = within(progress).getAllByRole('listitem')
    expect(steps).toHaveLength(2)
    expect(steps[0]).toHaveTextContent('Level 1Alex ManagerApproved')
    expect(steps[1]).toHaveTextContent('Level 2Parker PMConcern recorded')
    expect(steps[1]).toHaveTextContent(
      'Recorded by Harper HR on behalf of the assigned approver',
    )
  })

  it('[P1] preserves the HR audit column while personal-history filters are active', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage('/my-leaves?status=DECLINED', 'ORGANIZATION_ADMIN')

    const historyRegion = await screen.findByTestId('my-leaves-history-table')
    expect(within(historyRegion).getByRole('columnheader', { name: 'Audit' }))
      .toBeInTheDocument()
    expect(screen.getByTestId('audit-history-expander-2')).toBeInTheDocument()
    expect(screen.queryByTestId('my-leaves-request-row-1')).not.toBeInTheDocument()
  })

  it('[P1] shows status hints and declined reason verbatim', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    const pendingRow = await screen.findByTestId('my-leaves-request-row-1')
    expect(within(pendingRow).getByText('Waiting for approval')).toBeInTheDocument()

    const approvedRow = screen.getByTestId('my-leaves-request-row-3')
    expect(within(approvedRow).getByText('Approved by Alex')).toBeInTheDocument()

    const declinedRow = screen.getByTestId('my-leaves-request-row-2')
    expect(
      within(declinedRow).getByText(/Team needs in-office coverage for sprint review/),
    ).toBeInTheDocument()
  })

  it('[P0] exposes the same primary facts in task-preserving mobile cards', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    const mobileCard = await screen.findByTestId('my-leaves-request-card-2')
    expect(mobileCard).toHaveTextContent('Sick Leave')
    expect(mobileCard).toHaveTextContent('Jun 12, 2026')
    expect(mobileCard).toHaveTextContent('1 working day')
    expect(mobileCard).toHaveTextContent('Declined')
    expect(mobileCard).toHaveTextContent(
      'Team needs in-office coverage for sprint review',
    )
    expect(within(mobileCard).getByRole('button', { name: /Details for Sick Leave/i }))
      .toHaveAttribute('aria-expanded', 'false')
  })

  it('[P0] expands stored working-day context without inventing per-date evidence', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)
    const user = userEvent.setup()

    renderMyLeavesPage()

    const row = await screen.findByTestId('my-leaves-request-row-2')
    await user.click(within(row).getByRole('button', { name: /Details for Sick Leave/i }))

    const details = await screen.findByTestId('my-leaves-request-details-2')
    expect(details).toHaveTextContent('1 working day')
    expect(details).toHaveTextContent(`Workforce Group on your profile: ${isolate('US')}`)
    expect(details).toHaveTextContent(
      'Individual charged and excluded dates were not returned',
    )
    expect(within(details).queryByTestId('working-day-chips')).not.toBeInTheDocument()
  })

  it('[P0] localizes structured status hints instead of rendering raw server English', async () => {
    await act(() => i18n.changeLanguage('ar'))
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    const pendingRow = await screen.findByTestId('my-leaves-request-row-1')
    expect(pendingRow).toHaveTextContent('بانتظار الاعتماد')
    expect(pendingRow).not.toHaveTextContent('Waiting for approval')

    const approvedRow = screen.getByTestId('my-leaves-request-row-3')
    expect(approvedRow).toHaveTextContent('اعتمده Alex')
    expect(approvedRow).not.toHaveTextContent('Approved by Alex')
  })

  it('[P1] shows empty state while keeping Request Leave CTA available', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([])

    renderMyLeavesPage()

    await waitFor(() => {
      expect(screen.getByTestId('my-leaves-empty-state')).toBeInTheDocument()
    })

    expect(screen.getByText(/No leave requests yet/)).toBeInTheDocument()
    expect(screen.getByTestId('request-leave-btn')).toBeEnabled()
    expect(screen.queryByText('Leave history and balance grid ship in Story 3.5.')).not.toBeInTheDocument()
  })

  it('[P1] opens shared Request Leave modal from My Leaves', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([])
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    const user = userEvent.setup()

    renderMyLeavesPage()

    await user.click(screen.getByTestId('request-leave-btn'))

    expect(screen.getByTestId('request-leave-modal')).toBeInTheDocument()
  })

  it('[P1] refreshes history and shows the existing toast after shared modal submit', async () => {
    const balanceSpy = vi
      .spyOn(apiClient, 'getDashboardBalances')
      .mockResolvedValue(mockBalances)
    const historySpy = vi
      .spyOn(apiClient, 'getMyLeaveRequests')
      .mockResolvedValueOnce([])
      .mockResolvedValue(mockHistory)
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreview)
    vi.spyOn(apiClient, 'createLeaveRequest').mockResolvedValue(mockCreateResponse)
    const user = userEvent.setup()

    renderMyLeavesPage()

    await waitFor(() => {
      expect(screen.getByTestId('my-leaves-empty-state')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('request-leave-btn'))
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-08-03', '2026-08-07')
    await waitFor(() => expect(screen.getByTestId('submit-request-btn')).toBeEnabled())
    await user.click(screen.getByTestId('submit-request-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('app-toast')).toHaveTextContent(
        'Leave request submitted',
      )
      expect(historySpy).toHaveBeenCalledTimes(2)
      expect(balanceSpy).toHaveBeenCalledTimes(2)
    })
  })
})

/**
 * Story 3.8 / 11.2 "Your next step" priority chain, re-homed from the deleted
 * DashboardPage.test.tsx by the Dashboard merge (2026-09-01). The chain itself
 * did not change — approvals outrank the viewer's own requests — so the merge
 * must not be allowed to quietly drop its only proof. Covers DASH-VAL-014,
 * LEAVE-VAL-040 and the UI half of LEAVE-VAL-042.
 */
describe('MyLeavesPage attention priority — Story 3.8 / 11.2', () => {
  function renderForRole(role: UserRole) {
    vi.spyOn(apiClient, 'getApprovalCapability').mockResolvedValue({
      canReviewApprovals: role === 'MANAGER' || role === 'ORGANIZATION_ADMIN',
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    return {
      queryClient,
      ...render(
        <MemoryRouter initialEntries={['/my-leaves']}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <AuthTestProvider value={createMockAuthForRole(role)}>
                <MyLeavesPage />
              </AuthTestProvider>
            </ToastProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    }
  }

  beforeEach(() => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([])
    vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 0 })
    // Plan VUELTA: an Organization Admin's badge sums both queues, so the cancellation
    // count is part of every render that resolves it.
    vi.spyOn(apiClient, 'getPendingCancellationCount').mockResolvedValue({ count: 0 })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (i18n.language !== 'en') {
      await act(() => i18n.changeLanguage('en'))
    }
  })

  it.each<UserRole>(['MANAGER', 'ORGANIZATION_ADMIN'])(
    '[P0] prioritizes pending approvals over the viewer own request for %s',
    async (role) => {
      vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 2 })

      renderForRole(role)

      const attention = await screen.findByTestId('dashboard-attention')
      await waitFor(() => {
        expect(attention).toHaveTextContent('2 pending approvals')
      })
      expect(screen.getByRole('link', { name: 'Review Now' })).toHaveAttribute(
        'href',
        '/approvals',
      )
      // mockHistory carries the viewer's own PENDING request (id 1); the
      // approvals branch must outrank it rather than merely coexist.
      expect(attention).not.toHaveTextContent('Request awaiting approval')
    },
  )

  it('[P0] falls through to the viewer own request when the approval queue is empty', async () => {
    renderForRole('MANAGER')

    const attention = await screen.findByTestId('dashboard-attention')
    await waitFor(() => {
      expect(attention).toHaveTextContent('Request awaiting approval')
    })
    expect(screen.queryByRole('link', { name: 'Review Now' })).not.toBeInTheDocument()
  })

  it('[P0] never offers the approvals branch to an Employee', async () => {
    // The count endpoint is disabled for non-reviewers, but mock it non-zero so
    // the assertion proves the capability gate rather than an empty response.
    vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 4 })

    renderForRole('EMPLOYEE')

    const attention = await screen.findByTestId('dashboard-attention')
    await waitFor(() => {
      expect(attention).toHaveTextContent('Request awaiting approval')
    })
    expect(attention).not.toHaveTextContent('4 pending approvals')
    expect(screen.queryByRole('link', { name: 'Review Now' })).not.toBeInTheDocument()
  })

  it('[P1] replaces approval priority with the calm state after a zero refetch', async () => {
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([])
    vi.spyOn(apiClient, 'getPendingApprovalCount')
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValue({ count: 0 })

    const { queryClient } = renderForRole('MANAGER')

    expect(await screen.findByText('2 pending approvals')).toBeInTheDocument()
    // mockUsers.manager.id — the pending-count key is scoped per user.
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ['approvals', 'pending-count', 1] }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-attention')).toHaveTextContent(
        'Nothing needs your attention',
      )
    })
    expect(screen.queryByRole('link', { name: 'Review Now' })).not.toBeInTheDocument()
  })
})
