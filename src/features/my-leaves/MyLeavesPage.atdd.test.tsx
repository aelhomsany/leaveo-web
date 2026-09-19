import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { BalanceCardResponse, RecentRequestResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockRecentRequestResponse } from '../../test/apiFixtures'
import { ToastProvider } from '../../components/ui/ToastProvider'
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
  mockRecentRequestResponse({
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
  }),
  mockRecentRequestResponse({
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
  }),
  mockRecentRequestResponse({
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
  }),
]

type MyLeavesApiClient = typeof apiClient & {
  getMyLeaveRequests: () => Promise<RecentRequestResponse[]>
}

function renderMyLeavesPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
          <MyLeavesPage />
        </AuthTestProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('MyLeavesPage ATDD - Story 3.5', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.skip('[P1] renders mirrored balance grid and full personal history', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient as MyLeavesApiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    await waitFor(() => {
      expect(screen.getByTestId('my-leaves-balance-grid')).toBeInTheDocument()
    })

    expect(screen.getByTestId('balance-card-annual-leave')).toBeInTheDocument()
    expect(screen.getByTestId('balance-card-unpaid-leave')).toBeInTheDocument()
    expect(screen.getByTestId('my-leaves-history-table')).toBeInTheDocument()
    expect(screen.getByTestId('my-leaves-request-row-3')).toHaveTextContent('Approved')
    expect(screen.getByTestId('my-leaves-request-row-2')).toHaveTextContent('Declined')
    expect(screen.getByTestId('my-leaves-request-row-1')).toHaveTextContent('Pending')
  })

  it.skip('[P1] shows status hints and declined reason verbatim', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient as MyLeavesApiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

    renderMyLeavesPage()

    await waitFor(() => {
      expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    })

    expect(screen.getByText('Approved by Alex')).toBeInTheDocument()
    expect(screen.getByText(/Team needs in-office coverage for sprint review/)).toBeInTheDocument()
  })

  it.skip('[P1] shows empty state while keeping Request Leave CTA available', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient as MyLeavesApiClient, 'getMyLeaveRequests').mockResolvedValue([])

    renderMyLeavesPage()

    await waitFor(() => {
      expect(screen.getByTestId('my-leaves-empty-state')).toBeInTheDocument()
    })

    expect(screen.getByTestId('request-leave-btn')).toBeEnabled()
    expect(screen.queryByText('Leave history and balance grid ship in Story 3.5.')).not.toBeInTheDocument()
  })

  it.skip('[P1] opens shared Request Leave modal from My Leaves', async () => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
    vi.spyOn(apiClient as MyLeavesApiClient, 'getMyLeaveRequests').mockResolvedValue([])
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue([])
    const user = userEvent.setup()

    renderMyLeavesPage()

    await user.click(screen.getByTestId('request-leave-btn'))

    expect(screen.getByTestId('request-leave-modal')).toBeInTheDocument()
  })
})
