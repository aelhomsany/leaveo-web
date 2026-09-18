import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { BalanceCardResponse, RecentRequestResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockRecentRequestResponse } from '../../test/apiFixtures'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { MyLeavesPage } from './MyLeavesPage'

/** Story 11.3 — SPA cannot-proceed recovery + URL state restoration. */

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

function renderMyLeaves(initialPath = '/my-leaves') {
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
          <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
            <MyLeavesPage />
          </AuthTestProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('MyLeavesFindability ATDD — Story 11.3', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(
    '[P0] Given search with no matches, When Clear Filters is used, Then history restores and filters reset',
    async () => {
      vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
      vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)
      const user = userEvent.setup()

      renderMyLeaves()

      await screen.findByTestId('my-leaves-history')
      await user.type(screen.getByTestId('my-leaves-search'), 'zzzz-no-match-11-3')

      expect(await screen.findByTestId('my-leaves-filter-empty')).toHaveTextContent(
        /no requests match these filters/i,
      )
      expect(screen.getByTestId('my-leaves-clear-filters')).toBeInTheDocument()
      expect(screen.queryByTestId('my-leaves-request-row-1')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('my-leaves-clear-filters'))

      expect(screen.queryByTestId('my-leaves-filter-empty')).not.toBeInTheDocument()
      expect(screen.getByTestId('my-leaves-request-row-1')).toBeInTheDocument()
      expect(screen.getByTestId('my-leaves-search')).toHaveValue('')
    },
  )

  it(
    '[P0] Given URL q and status, When the page mounts, Then filters restore and results compose (AND)',
    async () => {
      vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
      vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

      renderMyLeaves('/my-leaves?status=DECLINED&q=coverage')

      await waitFor(() => {
        expect(screen.getByTestId('my-leaves-search')).toHaveValue('coverage')
      })

      const declined = screen
        .getByTestId('my-leaves-status-filter')
        .querySelector('[aria-pressed="true"]')
      // Assert the resolved label, not a regex that also matches the raw
      // `common:status.declined` i18n fallback if the key were missing.
      expect(declined).toHaveTextContent('Declined')
      expect(declined).not.toHaveTextContent('common:')

      expect(await screen.findByTestId('my-leaves-request-row-2')).toBeInTheDocument()
      expect(screen.queryByTestId('my-leaves-request-row-1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('my-leaves-request-row-3')).not.toBeInTheDocument()
    },
  )

  it(
    '[P1] Given requestId in the URL for a loaded request, When the page mounts, Then that request receives focus/expansion',
    async () => {
      vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
      vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

      renderMyLeaves('/my-leaves?requestId=2')

      const row = await screen.findByTestId('my-leaves-request-row-2')
      expect(row).toHaveAttribute('data-focused', 'true')
      // In-place disclosure open (WorkingDayExplainer or details region)
      expect(screen.getByTestId('my-leaves-request-details-2')).toBeInTheDocument()
    },
  )

  it(
    '[P1] Given an unavailable requestId, When history loads, Then a non-sensitive fallback preserves My Leaves',
    async () => {
      vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
      vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(mockHistory)

      renderMyLeaves('/my-leaves?requestId=999999')

      const unavailable = await screen.findByTestId('my-leaves-request-not-found')
      expect(unavailable).toHaveTextContent(/request is not available/i)
      expect(unavailable).not.toHaveTextContent('999999')
      expect(screen.getByTestId('my-leaves-history')).toBeInTheDocument()
      expect(screen.getByTestId('my-leaves-request-row-3')).toBeInTheDocument()
    },
  )
})
