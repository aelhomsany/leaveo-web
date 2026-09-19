import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { PendingApprovalResponse, RecentApprovalDecisionResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockPendingApprovalResponse } from '../../test/apiFixtures'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { ApprovalsPage } from './ApprovalsPage'

/**
 * Story 11.4 — executable decision-confidence acceptance coverage.
 * Focus: cannot-proceed (empty decline / zero-day approve), decision-context
 * presence, focus return after approve. Authorization stays API-authoritative.
 */

type EnrichedPending = PendingApprovalResponse & {
  balanceRemaining?: number | null
  balanceAfterApproval?: number | null
}

const mockPending: EnrichedPending[] = [
  mockPendingApprovalResponse({
    requestId: 101,
    employeeUserId: 7,
    employeeFullName: 'Sarah Chen',
    dateFrom: '2026-06-15',
    dateTo: '2026-06-17',
    workingDays: 2,
    note: 'Family trip',
    workforceGroupName: 'US Workforce Group',
    weekendDays: ['SATURDAY', 'SUNDAY'],
    balanceCapped: true,
    balanceRemaining: 12,
    balanceAfterApproval: 10,
    balanceSufficient: true,
    submittedAt: '2026-06-01T10:00:00Z',
  }),
  mockPendingApprovalResponse({
    requestId: 102,
    employeeUserId: 8,
    employeeFullName: 'Jamie Lee',
    dateFrom: '2026-06-20',
    dateTo: '2026-06-20',
    workingDays: 1,
    note: null,
    workforceGroupName: 'US Workforce Group',
    weekendDays: ['SATURDAY', 'SUNDAY'],
    balanceCapped: true,
    balanceRemaining: 8,
    balanceAfterApproval: 7,
    balanceSufficient: true,
    submittedAt: '2026-06-02T10:00:00Z',
  }),
]

const mockZeroDay: EnrichedPending[] = [
  {
    ...mockPending[0],
    requestId: 201,
    workingDays: 0,
    balanceAfterApproval: 12,
  },
]

const mockRecent: RecentApprovalDecisionResponse[] = []

function renderApprovals(role: 'MANAGER' | 'ORGANIZATION_ADMIN' = 'MANAGER') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthTestProvider value={createMockAuthForRole(role)}>
          <ApprovalsPage />
        </AuthTestProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function stubInbox(pending: EnrichedPending[]) {
  vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(pending as PendingApprovalResponse[])
  vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue(mockRecent)
  // Plan VUELTA: the Organization Admin's cancellation queue renders above the leave queue.
  vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([])
  vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
  vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([])
}

describe('ApprovalDecisionConfidence ATDD — Story 11.4', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(
    '[P0] Given a pending Approval card, When it renders, Then the four decision facts and labelled actions are present',
    async () => {
      // RED until Approval cards ship (UX-DR39): approval-card-* + balance/coverage/weekend/explainer.
      stubInbox(mockPending)

      renderApprovals('MANAGER')

      const card = await screen.findByTestId('approval-card-101')
      expect(within(card).getByText('Sarah Chen')).toBeInTheDocument()
      expect(
        within(card).getByText('US Workforce Group', {
          selector: '.approval-group-pill',
        }),
      ).toBeInTheDocument()
      expect(
        within(card).getByText('Saturday, Sunday weekend', {
          selector: '.approval-weekend-rule',
        }),
      ).toBeInTheDocument()
      expect(within(card).getByText(/2 working day/i)).toBeInTheDocument()
      expect(screen.getByTestId('approval-balance-101')).toBeInTheDocument()
      expect(screen.getByTestId('approval-balance-101')).toHaveTextContent(/10|12/)
      expect(screen.getByTestId('coverage-summary')).toBeInTheDocument()
      expect(within(card).getByTestId('working-day-explainer')).toBeInTheDocument()
      expect(screen.getByTestId('approve-btn-101')).toBeEnabled()
      expect(screen.getByTestId('decline-btn-101')).toBeEnabled()
      expect(screen.getByTestId('approve-btn-101')).toHaveAccessibleName(/Sarah Chen/i)
      expect(screen.getByTestId('decline-btn-101')).toHaveAccessibleName(/Sarah Chen/i)
    },
  )

  it(
    '[P0] Given Decline, When the modal opens, Then it names requester and date range and blocks empty reason',
    async () => {
      stubInbox(mockPending)
      const user = userEvent.setup()

      renderApprovals('MANAGER')
      await screen.findByTestId('approval-card-101')
      await user.click(screen.getByTestId('decline-btn-101'))

      const modal = await screen.findByTestId('decline-modal')
      expect(modal).toHaveTextContent(/Sarah Chen/i)
      expect(modal).toHaveTextContent(/Jun|15|17|2026/)
      expect(screen.getByTestId('decline-confirm-btn')).toBeDisabled()

      await user.type(screen.getByTestId('decline-reason-input'), '   ')
      expect(screen.getByTestId('decline-confirm-btn')).toBeDisabled()
    },
  )

  it(
    '[P0] Given zero working days on a pending card, When it renders, Then Approve is not an enabled success path',
    async () => {
      stubInbox(mockZeroDay)

      renderApprovals('MANAGER')

      const card = await screen.findByTestId('approval-card-201')
      expect(within(card).getByTestId('working-day-explainer')).toBeInTheDocument()
      expect(screen.getByTestId('approve-btn-201')).toBeDisabled()
    },
  )

  it(
    '[P0] Given two pending cards, When the first is approved, Then focus moves to the next pending heading',
    async () => {
      stubInbox(mockPending)
      vi.spyOn(apiClient, 'approveLeaveRequest').mockResolvedValue({
        id: 101,
        status: 'APPROVED',
      } as never)
      const user = userEvent.setup()

      renderApprovals('MANAGER')
      await screen.findByTestId('approval-card-101')
      await user.click(screen.getByTestId('approve-btn-101'))

      await waitFor(() => {
        expect(screen.queryByTestId('approval-card-101')).not.toBeInTheDocument()
      })
      const nextHeading = screen.getByTestId('approval-card-heading-102')
      expect(nextHeading).toHaveFocus()
    },
  )

  it(
    '[P1] Given the last pending card is approved, When the inbox clears, Then focus moves to the All caught up heading',
    async () => {
      stubInbox([mockPending[0]])
      vi.spyOn(apiClient, 'approveLeaveRequest').mockImplementation(async () => {
        vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
        return { id: 101, status: 'APPROVED' } as never
      })
      const user = userEvent.setup()

      renderApprovals('MANAGER')
      await screen.findByTestId('approval-card-101')
      await user.click(screen.getByTestId('approve-btn-101'))

      const emptyHeading = await screen.findByTestId('approvals-all-caught-up-heading')
      expect(emptyHeading).toHaveFocus()
      expect(screen.getByTestId('approvals-empty-state')).toBeInTheDocument()
    },
  )

  it(
    '[P0] Given Approvals page hierarchy, When it renders, Then summary precedes cards precedes recent decisions',
    async () => {
      stubInbox(mockPending)

      renderApprovals('MANAGER')
      await screen.findByTestId('approval-card-101')

      const page = screen.getByTestId('approvals-page')
      const summary = screen.getByTestId('approvals-summary')
      const queue = screen.getByTestId('approvals-pending-list')
      const recent = screen.getByTestId('approvals-recent-decisions')

      const order = [summary, queue, recent].map((node) =>
        Array.from(page.querySelectorAll('[data-testid]')).indexOf(node),
      )
      expect(order[0]).toBeLessThan(order[1])
      expect(order[1]).toBeLessThan(order[2])
    },
  )
})
