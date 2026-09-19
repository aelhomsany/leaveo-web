import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isolate } from '../../i18n/bidi'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type {
  OutTodayResponse,
  PendingApprovalResponse,
  RecentApprovalDecisionResponse,
  UpcomingAbsenceResponse,
} from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockLeaveRequestResponse } from '../../test/apiFixtures'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { ApprovalsPage } from './ApprovalsPage'
import i18n from '../../i18n/config'
import { applyDocumentLanguage } from '../../i18n/documentLanguage'

const completeDecisionFacts = {
  schemaVersion: '1',
  scope: { workforceGroupId: 3, workforceGroupName: 'US' },
  requestedRange: { from: '2026-06-15', to: '2026-06-17' },
  evaluatedRange: { from: '2026-06-15', to: '2026-06-17' },
  evaluatedWorkingDays: 3,
  timezone: 'America/New_York',
  dateBasis: 'ORGANIZATION_OPERATIONAL_TIMEZONE',
  asOf: '2026-06-10T14:30:00Z',
  freshness: 'LIVE_QUERY',
  scheduledCount: 5,
  approvedOffCount: 0,
  pendingOffCount: 1,
  wfhCount: 0,
  availableCount: 5,
  unknownCount: 0,
  incomplete: false,
  suppressed: false,
  uncertaintyCodes: [],
  pendingAgeDays: 4,
  activationProvenance: 'SUBMISSION_CAPTURED',
  currentStage: 1,
  totalStages: 2,
  holidays: [],
}

const mockPendingApprovals: PendingApprovalResponse[] = [
  {
    requestId: 101,
    employeeUserId: 7,
    employeeFullName: 'Sarah Chen',
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-06-15',
    dateTo: '2026-06-17',
    workingDays: 2,
    note: 'Family trip',
    workforceGroupName: 'US',
    overlappingApprovedAbsences: 0,
    approvalLevel: 1,
    decidedOnBehalf: false,
    nominalApproverFirstName: null,
    balanceCarryoverAvailable: null,
    carryoverDaysToUse: null,
    carryoverExpiresOn: null,
  },
]

const mockRecentDecisions: RecentApprovalDecisionResponse[] = [
  {
    requestId: 201,
    employeeUserId: 8,
    employeeFullName: 'Jamie Lee',
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-05-01',
    dateTo: '2026-05-03',
    workingDays: 2,
    status: 'APPROVED',
    decisionResult: 'APPROVED',
    actorFirstName: 'Alex',
    decidedAt: '2026-05-02T10:00:00Z',
    decidedOnBehalf: false,
    nominalApproverFirstName: null,
  },
]

function renderApprovalsPage(role: 'MANAGER' | 'ORGANIZATION_ADMIN' = 'MANAGER') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthTestProvider value={createMockAuthForRole(role)}>
            <ApprovalsPage />
          </AuthTestProvider>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  }
}

describe('ApprovalsPage', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue([])
    // Plan VUELTA: the Organization Admin's cancellation queue renders above the leave queue.
    vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([])
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
    applyDocumentLanguage('en')
  })

  it('[P1] announces pending and recent loading states via role=status', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockImplementation(
      () => new Promise(() => undefined),
    )
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockImplementation(
      () => new Promise(() => undefined),
    )

    renderApprovalsPage('MANAGER')

    expect(
      screen.getByRole('status', { name: /loading pending requests/i }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(
      screen.getByRole('status', { name: /loading recent decisions/i }),
    ).toHaveAttribute('aria-busy', 'true')
  })

  // The coverage rail must SEPARATE presence from absence: Work From Home is presence. A rail
  // that folded WFH into "off today" would tell a manager three people are away when one of
  // them is at their desk.
  it('[P1] splits WFH from time off in the coverage rail', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([
      { userId: 1, fullName: 'A', presence: 'OFF' },
      { userId: 2, fullName: 'B', presence: 'OFF' },
      { userId: 3, fullName: 'C', presence: 'WFH' },
    ] as OutTodayResponse[])
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([
      { id: 9, userId: 4, fullName: 'D', dateFrom: '2026-06-20', workingDays: 1 },
    ] as UpcomingAbsenceResponse[])

    renderApprovalsPage('MANAGER')

    const note = await screen.findByTestId('approvals-coverage-note')
    // The screen renders before the queries resolve, and the loading placeholder is a
    // DIFFERENT element than the resolved summary -- so the node has to be re-queried on
    // every attempt, not captured once and re-read.
    await waitFor(() =>
      expect(within(note).getByTestId('coverage-summary')).toHaveTextContent(
        /off today\s*2/i,
      ),
    )
    const summary = within(note).getByTestId('coverage-summary')
    expect(summary).toHaveTextContent(/wfh today\s*1/i)
    expect(summary).toHaveTextContent(/upcoming\s*1/i)
  })

  // The rail used to be `display: none` below ~1204px. It is markup now, not a breakpoint, so
  // the advisory that governs a decision cannot be deleted by a viewport width.
  it('[P1] keeps the decision advisory in the rail', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)

    renderApprovalsPage('MANAGER')

    const note = await screen.findByTestId('approvals-decision-note')
    expect(within(note).getByText(/coverage watch is advisory/i)).toBeInTheDocument()
  })

  // The band above Recent Decisions counts what the server returned for THIS table. Scoped with
  // within() because the table underneath repeats every name and status the band mentions.
  it('[P1] counts the decisions the server returned in the recent-decisions band', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue(mockRecentDecisions)

    renderApprovalsPage('ORGANIZATION_ADMIN')

    const band = await screen.findByTestId('approvals-recent-band')
    await waitFor(() =>
      expect(within(band).getByTestId('approvals-recent-shown')).toHaveTextContent('1'),
    )
    expect(
      within(band).getByText(/days are the working days stored on the request/i),
    ).toBeInTheDocument()
  })

  // A failed decisions load must not read as "0 decisions" — that is a claim about the record,
  // not about the request that failed.
  it('[P1] withholds the recent-decisions count when the query fails', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockRejectedValue(new Error('boom'))

    renderApprovalsPage('ORGANIZATION_ADMIN')

    const band = await screen.findByTestId('approvals-recent-band')
    await waitFor(() =>
      expect(within(band).getByTestId('approvals-recent-shown')).toHaveTextContent('—'),
    )
  })

  // The audit panel opens in a row of its OWN spanning every column, not inside the audit
  // cell. That cell starts ~700px into a table wider than a phone, so a panel rendered there
  // opened entirely outside a 375px viewport.
  it('[P1] opens recent-decision audit history in a row spanning the table', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue(mockRecentDecisions)
    vi.spyOn(apiClient, 'getLeaveRequestAuditEvents').mockResolvedValue([])

    const user = userEvent.setup()
    renderApprovalsPage('ORGANIZATION_ADMIN')

    const toggle = await screen.findByRole('button', { name: /audit history for Jamie Lee/i })
    await user.click(toggle)

    const auditRow = await screen.findByTestId('recent-decision-audit-row-201')
    const cell = within(auditRow).getByRole('cell')
    // Spanning every column is what makes the panel start at the table's inline start.
    expect(cell).toHaveAttribute('colspan', '9')
    expect(within(auditRow).getByTestId('audit-history-panel')).toBeInTheDocument()
  })

  it('renders the page full-bleed (page-wide) like Settings', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)

    renderApprovalsPage('MANAGER')

    expect(screen.getByTestId('approvals-page')).toHaveClass('page', 'page-wide')
  })

  it('[P1] renders scoped pending approval rows with employee and leave details', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)

    renderApprovalsPage('MANAGER')

    await waitFor(() => {
      expect(screen.getByTestId('approvals-pending-list')).toBeInTheDocument()
    })

    const row = screen.getByTestId('approval-card-101')
    expect(row).toBeInTheDocument()
    expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    expect(row).toHaveTextContent('Annual Leave')
    expect(row).toHaveTextContent(/2 working day/)
    expect(row).toHaveTextContent(/Family trip/)
    expect(screen.getByTestId('approve-btn-101')).toBeInTheDocument()
    expect(screen.getByTestId('decline-btn-101')).toBeInTheDocument()
  })

  it('[P1] shows All caught up! empty state when inbox is empty', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])

    renderApprovalsPage('MANAGER')

    await waitFor(() => {
      expect(screen.getByTestId('approvals-empty-state')).toBeInTheDocument()
    })

    expect(screen.getByText('All caught up!')).toBeInTheDocument()
    expect(screen.queryByTestId('approval-card-101')).not.toBeInTheDocument()
  })

  it('[P1] shows Organization Admin backstop subtitle copy', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])

    renderApprovalsPage('ORGANIZATION_ADMIN')

    await waitFor(() => {
      expect(screen.getByTestId('approvals-page')).toBeInTheDocument()
    })

    expect(
      screen.getByText(/Review organization approval requests and act on behalf when needed/i),
    ).toBeInTheDocument()
  })

  it('[P1] approve fires mutation, shows durable success feedback, and invalidates related queries', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)
    const approveSpy = vi.spyOn(apiClient, 'approveLeaveRequest').mockResolvedValue(
      mockLeaveRequestResponse(),
    )

    const { queryClient } = renderApprovalsPage('MANAGER')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByTestId('approve-btn-101')).toBeEnabled())
    await user.click(screen.getByTestId('approve-btn-101'))

    expect(approveSpy).toHaveBeenCalledWith(101, 1)
    await waitFor(() =>
      expect(screen.getByTestId('approvals-decision-feedback')).toHaveTextContent(/approved/i),
    )

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]))
    expect(invalidatedKeys.some((k) => k.includes('approvals') && k.includes('pending'))).toBe(true)
    expect(invalidatedKeys.some((k) => k.includes('dashboard') && k.includes('balances'))).toBe(true)
    expect(invalidatedKeys.some((k) => k.includes('leave-requests'))).toBe(true)
  })

  it('[P1] decline opens the DeclineModal for the row', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)

    renderApprovalsPage('MANAGER')
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByTestId('decline-btn-101')).toBeEnabled())
    await user.click(screen.getByTestId('decline-btn-101'))

    expect(screen.getByTestId('decline-modal')).toBeInTheDocument()
    expect(screen.getByTestId('decline-confirm-btn')).toBeDisabled()
  })

  it('[P0] level-two reviewer records a required concern and advances the queue', async () => {
    const levelTwoApproval: PendingApprovalResponse = {
      ...mockPendingApprovals[0],
      approvalLevel: 2,
      approvalEvidence: [],
    }
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([levelTwoApproval])
    const concernSpy = vi.spyOn(apiClient, 'recordApprovalConcern').mockResolvedValue(
      mockLeaveRequestResponse(),
    )
    const user = userEvent.setup()

    renderApprovalsPage('MANAGER')

    await user.click(await screen.findByTestId('concern-btn-101'))
    const dialog = screen.getByRole('dialog', { name: /record project concern/i })
    const confirm = within(dialog).getByRole('button', { name: /record concern/i })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/concern note/i), 'Project coverage discussed')
    await user.click(confirm)

    expect(concernSpy).toHaveBeenCalledWith(101, 'Project coverage discussed', 2)
    await waitFor(() => {
      expect(screen.getByTestId('approvals-decision-feedback')).toHaveTextContent(/concern recorded/i)
    })
  })

  it('[P1] identifies the assigned approver when HR acts on a pending row', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        nominalApproverFirstName: 'Morgan',
      },
    ])

    renderApprovalsPage('ORGANIZATION_ADMIN')

    await waitFor(() => expect(screen.getByTestId('approval-card-101')).toBeInTheDocument())
    expect(screen.getByTestId('assigned-approver-pill-101')).toHaveTextContent(
      `Assigned approver: ${isolate('Morgan')}`,
    )
    expect(screen.getByTestId('on-behalf-notice-101')).toHaveTextContent(
      `acting on behalf of assigned approver ${isolate('Morgan')}`,
    )
    expect(screen.queryByTestId('on-behalf-pill-101')).not.toBeInTheDocument()
  })

  it('[P1] retains stale request context and disables its actions after a 409 conflict', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)
    vi.spyOn(apiClient, 'approveLeaveRequest').mockRejectedValue(
      new apiClient.ApiError(409, {
        status: 409,
        detail: 'Leave request was already decided',
      }),
    )
    const user = userEvent.setup()

    renderApprovalsPage('MANAGER')
    await user.click(await screen.findByTestId('approve-btn-101'))

    expect(await screen.findByTestId('approval-card-101')).toHaveTextContent(
      /no longer actionable/i,
    )
    expect(screen.getByTestId('approve-btn-101')).toBeDisabled()
    expect(screen.getByTestId('decline-btn-101')).toBeDisabled()
    expect(screen.getByTestId('approvals-decision-feedback')).toHaveAttribute(
      'role',
      'alert',
    )
  })

  it('[P1] decline fires mutation, shows durable success feedback, and invalidates related queries', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)
    const declineSpy = vi.spyOn(apiClient, 'declineLeaveRequest').mockResolvedValue(
      mockLeaveRequestResponse({ status: 'DECLINED', declineReason: 'Coverage gap that week' }),
    )

    const { queryClient } = renderApprovalsPage('MANAGER')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByTestId('decline-btn-101')).toBeEnabled())
    await user.click(screen.getByTestId('decline-btn-101'))
    await user.type(screen.getByTestId('decline-reason-input'), 'Coverage gap that week')
    await user.click(screen.getByTestId('decline-confirm-btn'))

    expect(declineSpy).toHaveBeenCalledWith(101, 'Coverage gap that week', 1)
    await waitFor(() =>
      expect(screen.getByTestId('approvals-decision-feedback')).toHaveTextContent(/declined/i),
    )

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]))
    expect(invalidatedKeys.some((k) => k.includes('approvals') && k.includes('pending'))).toBe(true)
    expect(invalidatedKeys.some((k) => k.includes('dashboard') && k.includes('balances'))).toBe(true)
    expect(invalidatedKeys.some((k) => k.includes('leave-requests'))).toBe(true)
  })

  it('[P1] renders Recent Decisions table with status badges and empty state', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue(mockRecentDecisions)

    renderApprovalsPage('MANAGER')

    await waitFor(() => {
      expect(screen.getByTestId('recent-decisions-table')).toBeInTheDocument()
    })

    const recentDecisionsRegion = screen.getByRole('region', { name: 'Recent Decisions' })
    expect(recentDecisionsRegion).toHaveAttribute('tabindex', '0')

    expect(screen.getByTestId('recent-decision-row-201')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('Alex')).toBeInTheDocument()
  })

  it('[P1] shows Recent Decisions empty state without hiding pending queue', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)

    renderApprovalsPage('MANAGER')

    await waitFor(() => {
      expect(screen.getByTestId('approvals-pending-list')).toBeInTheDocument()
    })

    expect(screen.getByTestId('recent-decisions-empty')).toBeInTheDocument()
  })

  it('[P1] shows on-behalf pill in Recent Decisions for HR backstop decisions', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue([
      {
        ...mockRecentDecisions[0],
        decidedOnBehalf: true,
        nominalApproverFirstName: 'Morgan',
        actorFirstName: 'Jordan',
      },
    ])

    renderApprovalsPage('ORGANIZATION_ADMIN')

    await waitFor(() => {
      expect(screen.getByTestId('recent-on-behalf-pill-201')).toBeInTheDocument()
    })

    expect(screen.getByTestId('recent-on-behalf-pill-201')).toHaveTextContent(
      /On behalf of assigned approver Morgan/i,
    )
  })

  it('[P1] approve invalidates pending count and recent decisions queries', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)
    vi.spyOn(apiClient, 'approveLeaveRequest').mockResolvedValue(mockLeaveRequestResponse())

    const { queryClient } = renderApprovalsPage('MANAGER')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByTestId('approve-btn-101')).toBeEnabled())
    await user.click(screen.getByTestId('approve-btn-101'))

    await waitFor(() =>
      expect(screen.getByTestId('approvals-decision-feedback')).toHaveTextContent(/approved/i),
    )

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]))
    expect(invalidatedKeys.some((k) => k.includes('pending-count'))).toBe(true)
    expect(invalidatedKeys.some((k) => k.includes('recent-decisions'))).toBe(true)
  })

  it('[P0] keeps the same request visible when it advances to the next approval level', async () => {
    const levelOne = { ...mockPendingApprovals[0], approvalLevel: 1 }
    const levelTwo = {
      ...mockPendingApprovals[0],
      approvalLevel: 2,
      approvalEvidence: [],
    }
    vi.spyOn(apiClient, 'getPendingApprovals')
      .mockResolvedValueOnce([levelOne])
      .mockResolvedValue([levelTwo])
    vi.spyOn(apiClient, 'approveLeaveRequest').mockResolvedValue(mockLeaveRequestResponse())
    const user = userEvent.setup()

    renderApprovalsPage('MANAGER')
    await user.click(await screen.findByTestId('approve-btn-101'))

    await waitFor(() => {
      expect(screen.getByTestId('approval-card-101')).toHaveTextContent(
        /Current approval: level 2/i,
      )
    })
  })

  it('[P1] approve refetch clears pending row and adds Recent Decisions entry', async () => {
    const approvedDecision: RecentApprovalDecisionResponse = {
      requestId: 101,
      employeeUserId: 7,
      employeeFullName: 'Sarah Chen',
      leaveTypeId: 1,
      leaveTypeName: 'Annual Leave',
      leaveTypeIcon: 'leave',
      leaveTypeColor: '#093C5D',
      leaveTypeBackgroundColor: '#D6E8ED',
      leaveTypeBorderColor: '#0E4F75',
      dateFrom: '2026-06-15',
      dateTo: '2026-06-17',
      workingDays: 2,
      status: 'APPROVED',
      decisionResult: 'APPROVED',
      actorFirstName: 'Alex',
      decidedAt: '2026-06-21T10:00:00Z',
      decidedOnBehalf: false,
      nominalApproverFirstName: null,
    }

    vi.spyOn(apiClient, 'getPendingApprovals')
      .mockResolvedValueOnce(mockPendingApprovals)
      .mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions')
      .mockResolvedValueOnce([])
      .mockResolvedValue([approvedDecision])
    vi.spyOn(apiClient, 'approveLeaveRequest').mockResolvedValue(mockLeaveRequestResponse())

    const user = userEvent.setup()
    renderApprovalsPage('MANAGER')

    await waitFor(() => expect(screen.getByTestId('approval-card-101')).toBeInTheDocument())
    await user.click(screen.getByTestId('approve-btn-101'))

    await waitFor(() =>
      expect(screen.getByTestId('approvals-decision-feedback')).toHaveTextContent(/approved/i),
    )
    await waitFor(() => {
      expect(screen.queryByTestId('approval-card-101')).not.toBeInTheDocument()
      expect(screen.getByTestId('recent-decision-row-101')).toBeInTheDocument()
    })
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('[P1] decline invalidates pending count and recent decisions queries', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue(mockPendingApprovals)
    vi.spyOn(apiClient, 'declineLeaveRequest').mockResolvedValue(
      mockLeaveRequestResponse({ status: 'DECLINED', declineReason: 'Coverage gap that week' }),
    )

    const { queryClient } = renderApprovalsPage('MANAGER')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByTestId('decline-btn-101')).toBeEnabled())
    await user.click(screen.getByTestId('decline-btn-101'))
    await user.type(screen.getByTestId('decline-reason-input'), 'Coverage gap that week')
    await user.click(screen.getByTestId('decline-confirm-btn'))

    await waitFor(() =>
      expect(screen.getByTestId('approvals-decision-feedback')).toHaveTextContent(/declined/i),
    )

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]))
    expect(invalidatedKeys.some((k) => k.includes('pending-count'))).toBe(true)
    expect(invalidatedKeys.some((k) => k.includes('recent-decisions'))).toBe(true)
  })

  // APPROVAL-VAL-022 (P0, SPA-only): in-flight decision state is keyed by
  // (requestId, approvalLevel). Starting a second decision must not hand the first
  // card back to the approver mid-flight (Story 11.4 AC6 duplicate-submit guarantee).
  it('[P0] keeps the first card busy while a second decision starts', async () => {
    const secondApproval: PendingApprovalResponse = {
      ...mockPendingApprovals[0],
      requestId: 102,
      employeeUserId: 8,
      employeeFullName: 'Jamie Lee',
    }
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      mockPendingApprovals[0],
      secondApproval,
    ])

    const resolvers = new Map<number, (value: never) => void>()
    const approveSpy = vi
      .spyOn(apiClient, 'approveLeaveRequest')
      .mockImplementation(
        (id: number) =>
          new Promise((resolve) => {
            resolvers.set(id, resolve as (value: never) => void)
          }),
      )
    const user = userEvent.setup()

    renderApprovalsPage('MANAGER')

    await waitFor(() => expect(screen.getByTestId('approve-btn-101')).toBeEnabled())

    // Two clicks inside one tick, before React can re-render the button as disabled.
    // This is the only path that actually reaches the `beginDecision` re-entrancy
    // guard: every UI entry point is `disabled` once the card is busy, so clicking a
    // busy button dispatches nothing and would assert the guard vacuously. If
    // `beginDecision` stopped refusing, the second click would fire a second mutation.
    await act(async () => {
      const approveFirst = screen.getByTestId('approve-btn-101')
      approveFirst.click()
      approveFirst.click()
    })
    expect(approveSpy.mock.calls.filter(([id]) => id === 101)).toHaveLength(1)

    await waitFor(() =>
      expect(screen.getByTestId('approve-btn-101')).toHaveAttribute('data-busy', 'true'),
    )

    await user.click(screen.getByTestId('approve-btn-102'))
    await waitFor(() =>
      expect(screen.getByTestId('approve-btn-102')).toHaveAttribute('data-busy', 'true'),
    )

    // The second decision must not re-enable the first card's actions.
    expect(screen.getByTestId('approve-btn-101')).toHaveAttribute('data-busy', 'true')
    expect(screen.getByTestId('approve-btn-101')).toBeDisabled()
    expect(screen.getByTestId('decline-btn-101')).toBeDisabled()

    // Settling the first decision releases only its own key.
    await act(async () => {
      resolvers.get(101)?.({ id: 101, status: 'APPROVED' } as never)
    })
    await waitFor(() =>
      expect(screen.queryByTestId('approval-card-101')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('approve-btn-102')).toHaveAttribute('data-busy', 'true')

    await act(async () => {
      resolvers.get(102)?.({ id: 102, status: 'APPROVED' } as never)
    })
  })

  // APPROVAL-VAL-016 (P0): the page must hand the server's coverage fact to the card.
  // Nothing asserted this wiring, and because the fixture omitted the field every
  // page test rendered the "unavailable" fallback — so ApprovalsPage could stop
  // passing `overlappingApprovedAbsences` entirely and the suite stayed green.
  // Missing i18n keys resolve to an empty string in this app (i18n/config.ts
  // parseMissingKeyHandler), so this asserts the real sentence rather than presence.
  it('[P0] renders the server-supplied overlap count on the card', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      { ...mockPendingApprovals[0], overlappingApprovedAbsences: 2 },
    ])

    renderApprovalsPage('MANAGER')

    const region = await screen.findByTestId('approval-coverage-101')
    expect(region).toHaveTextContent(
      '2 colleagues are away during this range.',
    )
    expect(region).not.toHaveTextContent('Some coverage facts are unavailable.')
  })

  it('[P0] renders labelled server decision facts with zero preserved as zero', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        decisionFacts: completeDecisionFacts,
      } as PendingApprovalResponse,
    ])

    renderApprovalsPage('MANAGER')

    const facts = await screen.findByTestId('approval-decision-facts-101')
    expect(within(facts).getByText('5 scheduled')).toBeInTheDocument()
    expect(within(facts).getByText('0 approved off')).toBeInTheDocument()
    expect(within(facts).getByText('1 pending off')).toBeInTheDocument()
    expect(within(facts).getByText('0 working from home')).toBeInTheDocument()
    expect(within(facts).getByText('5 available')).toBeInTheDocument()
    expect(facts).toHaveTextContent('No relevant holidays')
    expect(facts).toHaveTextContent('Pending for 4 days')
    expect(facts).toHaveTextContent('Stage 1 of 2')
    expect(facts).toHaveTextContent('America/New_York')
  })

  it('[P0] renders unknown as unknown and leaves advisory facts outside decision guards', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        decisionFacts: {
          ...completeDecisionFacts,
          scheduledCount: null,
          approvedOffCount: null,
          pendingOffCount: null,
          wfhCount: null,
          availableCount: null,
          evaluatedRange: null,
          holidays: null,
          unknownCount: 1,
          incomplete: true,
          uncertaintyCodes: ['WORKFORCE_GROUP_UNKNOWN'],
        },
      } as PendingApprovalResponse,
    ])

    renderApprovalsPage('MANAGER')

    const facts = await screen.findByTestId('approval-decision-facts-101')
    // Five counts, the evaluated range, and the holiday list: an unevaluated calendar must not
    // report "No relevant holidays", which is a confident claim the server never made.
    expect(within(facts).getAllByText('Unknown')).toHaveLength(7)
    expect(facts).not.toHaveTextContent('No relevant holidays')
    // Names the missing context rather than leading with a bare count.
    expect(facts).toHaveTextContent(
      'Some facts are incomplete — this person is not assigned to a Workforce Group',
    )
    expect(screen.getByTestId('approve-btn-101')).toBeEnabled()
    expect(screen.getByTestId('decline-btn-101')).toBeEnabled()
  })

  // AVAIL-UI-VAL-002 (P0): SCHEDULE_UNKNOWN is the code the server now sends when it could not
  // resolve the requester's own schedule. Rendering it needs BOTH halves of the fix: membership in
  // COUNT_UNCERTAINTY_CODES and a real locale string. A code missing either one falls through
  // `defaultValue: ''` and is filtered out, so the card would claim "incomplete" and then name no
  // reason at all -- the failure mode is silence, which no other assertion here would catch.
  it('[P0] names an unresolved schedule as the reason a card is incomplete', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        decisionFacts: {
          ...completeDecisionFacts,
          scheduledCount: null,
          approvedOffCount: null,
          pendingOffCount: null,
          wfhCount: null,
          availableCount: null,
          unknownCount: 1,
          incomplete: true,
          uncertaintyCodes: ['SCHEDULE_UNKNOWN'],
        },
      } as PendingApprovalResponse,
    ])

    renderApprovalsPage('MANAGER')

    const facts = await screen.findByTestId('approval-decision-facts-101')
    expect(facts).toHaveTextContent(
      "Some facts are incomplete — some teammates' work schedules could not be resolved",
    )
  })

  it('[P0] does not label a card incomplete for approximate activation alone', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        decisionFacts: {
          ...completeDecisionFacts,
          activationProvenance: 'APPROXIMATE',
          uncertaintyCodes: ['ACTIVATION_TIME_APPROXIMATE'],
        },
      } as PendingApprovalResponse,
    ])

    renderApprovalsPage('MANAGER')

    const facts = await screen.findByTestId('approval-decision-facts-101')
    expect(facts).toHaveTextContent('approximate activation time')
    expect(facts).not.toHaveTextContent('Some facts are incomplete')
  })

  it('[P0] renders relevant holidays with their names and dates', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        decisionFacts: {
          ...completeDecisionFacts,
          holidays: [
            { name: 'Independence Day', dateFrom: '2026-06-16', dateTo: '2026-06-16' },
            { name: 'Founders Week', dateFrom: '2026-06-17', dateTo: '2026-06-18' },
          ],
        },
      } as PendingApprovalResponse,
    ])

    renderApprovalsPage('MANAGER')

    const facts = await screen.findByTestId('approval-decision-facts-101')
    expect(within(facts).getByText('Independence Day')).toBeInTheDocument()
    expect(within(facts).getByText('Founders Week')).toBeInTheDocument()
    expect(facts).not.toHaveTextContent('No relevant holidays')
  })

  it('[P0] survives a snapshot timezone the browser cannot resolve', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        decisionFacts: { ...completeDecisionFacts, timezone: 'Not/AZone' },
      } as PendingApprovalResponse,
    ])

    renderApprovalsPage('MANAGER')

    // Intl.DateTimeFormat throws RangeError on an unknown zone; the card must drop the
    // formatted instant rather than take the whole list down with it.
    const facts = await screen.findByTestId('approval-decision-facts-101')
    expect(facts).toHaveTextContent('Not/AZone')
    expect(screen.getByTestId('approve-btn-101')).toBeEnabled()
  })

  it('[P0] renders the decision-facts contract in Arabic', async () => {
    await i18n.changeLanguage('ar')
    applyDocumentLanguage('ar')
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([
      {
        ...mockPendingApprovals[0],
        decisionFacts: { ...completeDecisionFacts, pendingOffCount: 2 },
      } as PendingApprovalResponse,
    ])

    renderApprovalsPage('MANAGER')

    const facts = await screen.findByTestId('approval-decision-facts-101')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(facts).toHaveTextContent('بيانات القرار')
    expect(facts).toHaveTextContent('5 مجدولون')
    expect(facts).toHaveTextContent('المرحلة 1 من 2')
    // Arabic dual form — a bare {{count}} key would render the plural noun here.
    expect(facts).toHaveTextContent('شخصان في غياب معلّق')
  })

  // APPROVAL-VAL-032/033 (P0): decline and concern in-flight state moved off the shared
  // mutation's `isPending` onto the keyed map. Both page tests resolved immediately, so
  // no test observed either mid-flight — a wrong-kind lookup would leave the confirm
  // enabled and the modal dismissable during the request with nothing failing.
  it('[P0] keeps the decline modal and card busy while the decline is in flight', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([mockPendingApprovals[0]])
    let releaseDecline: (value: never) => void = () => undefined
    vi.spyOn(apiClient, 'declineLeaveRequest').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseDecline = resolve as (value: never) => void
        }),
    )
    const user = userEvent.setup()

    renderApprovalsPage('MANAGER')

    await user.click(await screen.findByTestId('decline-btn-101'))
    await user.type(screen.getByTestId('decline-reason-input'), 'Coverage too thin')
    await user.click(screen.getByTestId('decline-confirm-btn'))

    await waitFor(() =>
      expect(screen.getByTestId('decline-confirm-btn')).toHaveAttribute('data-busy', 'true'),
    )
    expect(screen.getByTestId('decline-confirm-btn')).toBeDisabled()
    expect(screen.getByTestId('decline-cancel-btn')).toBeDisabled()
    expect(screen.getByTestId('decline-btn-101')).toHaveAttribute('data-busy', 'true')

    await act(async () => {
      releaseDecline({ id: 101, status: 'DECLINED' } as never)
    })
  })

  it('[P0] keeps the concern modal and card busy while the concern is in flight', async () => {
    const levelTwoApproval: PendingApprovalResponse = {
      ...mockPendingApprovals[0],
      approvalLevel: 2,
      approvalEvidence: [],
    }
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([levelTwoApproval])
    let releaseConcern: (value: never) => void = () => undefined
    vi.spyOn(apiClient, 'recordApprovalConcern').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseConcern = resolve as (value: never) => void
        }),
    )
    const user = userEvent.setup()

    renderApprovalsPage('MANAGER')

    await user.click(await screen.findByTestId('concern-btn-101'))
    const dialog = screen.getByRole('dialog', { name: /record project concern/i })
    await user.type(within(dialog).getByLabelText(/concern note/i), 'Coverage discussed')
    await user.click(within(dialog).getByRole('button', { name: /record concern/i }))

    await waitFor(() =>
      expect(screen.getByTestId('concern-btn-101')).toHaveAttribute('data-busy', 'true'),
    )
    expect(within(dialog).getByRole('button', { name: /record concern/i })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeDisabled()

    await act(async () => {
      releaseConcern({ id: 101, status: 'APPROVED' } as never)
    })
  })

  it('[P2] does not show audit history affordance for managers', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue(mockRecentDecisions)

    renderApprovalsPage('MANAGER')

    await waitFor(() => expect(screen.getByTestId('recent-decisions-table')).toBeInTheDocument())
    expect(screen.queryByText('Audit history')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Audit' })).not.toBeInTheDocument()
  })

  it('[P2] shows audit history affordance for Organization admins on recent decisions', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue(mockRecentDecisions)

    renderApprovalsPage('ORGANIZATION_ADMIN')

    await waitFor(() => expect(screen.getByTestId('recent-decisions-table')).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'Audit' })).toBeInTheDocument()
    expect(screen.getByText('Audit history')).toBeInTheDocument()
  })
})
