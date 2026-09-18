import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type {
  LeaveRequestResponse,
  PendingCancellationResponse,
  UserRole,
} from '../../api/generated/types'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { isolate } from '../../i18n/bidi'
import i18n from '../../i18n/config'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { ApprovalsPage } from './ApprovalsPage'
import { usePendingApprovalCount } from './usePendingApprovalCount'

/**
 * Plan VUELTA / FR-57 — the Organization Admin's retroactive-cancellation queue, at the SPA-only
 * layer. The API proves the 403 for every other role; what only this layer can prove is that the
 * SPA does not render the queue (or count it in the bell) for anyone else, that declining insists
 * on a note before it dispatches, and that a decision cannot be fired twice.
 */

function cancellation(
  overrides: Partial<PendingCancellationResponse> = {},
): PendingCancellationResponse {
  return {
    publicId: 'c-1',
    leaveRequestId: 501,
    employeeUserId: 7,
    employeeFullName: 'Sarah Chen',
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    dateFrom: '2026-08-03',
    dateTo: '2026-08-05',
    workingDays: 3,
    reason: 'Trip was called off after it started.',
    requestedAt: '2026-08-06T09:00:00Z',
    daysToRestore: 3,
    carryoverDaysToRestore: 0,
    daysForfeited: 0,
    balanceYear: 2026,
    ...overrides,
  }
}

function renderApprovals(role: UserRole = 'ORGANIZATION_ADMIN', strict = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const tree = (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthTestProvider value={createMockAuthForRole(role)}>
          <ApprovalsPage />
        </AuthTestProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

/** Reads the bell's number without dragging a whole shell into the test. */
function CountProbe() {
  const query = usePendingApprovalCount()
  return <span data-testid="count-probe">{query.data?.count ?? 'none'}</span>
}

function renderCountProbe(role: UserRole) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole(role)}>
        <CountProbe />
      </AuthTestProvider>
    </QueryClientProvider>,
  )
}

describe('Approvals cancellation queue', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue([])
    vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([])
    vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([])
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (i18n.language !== 'en') {
      await act(() => i18n.changeLanguage('en'))
    }
  })

  it('[P0] renders nothing at all for a manager, and the queue for an Organization Admin', async () => {
    // CANCEL-UI-VAL-006, first half. A manager is never asked to decide balance restitution — the
    // API answers them 403 — so the section must not appear, and must not even fetch.
    const list = vi
      .spyOn(apiClient, 'getPendingCancellations')
      .mockResolvedValue([cancellation()])

    renderApprovals('MANAGER')

    await screen.findByTestId('approvals-page')
    expect(screen.queryByTestId('approvals-cancellations')).not.toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })

  it('[P1] shows the queue to an Organization Admin with the server’s days and balance year', async () => {
    vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([cancellation()])

    renderApprovals('ORGANIZATION_ADMIN')

    const card = await screen.findByTestId('cancellation-card-501')
    expect(within(card).getByTestId('cancellation-card-heading-501')).toHaveTextContent(
      'Sarah Chen',
    )
    // Day count and balance year are the server's numbers, not arithmetic done here.
    expect(within(card).getByTestId('cancellation-consequence-501')).toHaveTextContent(
      // The year is bidi-isolated so an RTL sentence cannot reorder its digits.
      `Approving returns 3 working days to their ${isolate(2026)} balance.`,
    )
    expect(
      within(card).getByText('Trip was called off after it started.'),
    ).toBeInTheDocument()
  })

  it('[P1] counts both queues in an admin’s badge and only approvals in a manager’s', async () => {
    // CANCEL-UI-VAL-006, second half. The bell is everything waiting on you; for an Organization
    // Admin that is two queues, and a manager must not pay for a call they are forbidden to make.
    vi.spyOn(apiClient, 'getApprovalCapability').mockResolvedValue({
      canReviewApprovals: true,
    })
    vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 2 })
    const cancellationCount = vi
      .spyOn(apiClient, 'getPendingCancellationCount')
      .mockResolvedValue({ count: 3 })

    const admin = renderCountProbe('ORGANIZATION_ADMIN')
    await waitFor(() => {
      expect(screen.getByTestId('count-probe')).toHaveTextContent('5')
    })
    expect(cancellationCount).toHaveBeenCalledTimes(1)
    admin.unmount()

    renderCountProbe('MANAGER')
    await waitFor(() => {
      expect(screen.getByTestId('count-probe')).toHaveTextContent('2')
    })
    expect(cancellationCount).toHaveBeenCalledTimes(1)
  })

  it('[P0] will not decline without a note, then sends the trimmed note', async () => {
    // Declining is the outcome that changes nothing about the leave, so the reason is the only
    // record of why — the API requires it and the modal refuses to dispatch without it.
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([cancellation()])
    const declineCall = vi
      .spyOn(apiClient, 'declineLeaveCancellation')
      // The page ignores the mutation payload — only that it settles matters here.
      .mockResolvedValue({} as LeaveRequestResponse)

    renderApprovals('ORGANIZATION_ADMIN')

    await user.click(await screen.findByTestId('cancellation-decline-btn-501'))
    const confirm = screen.getByTestId('cancellation-decline-confirm-btn')
    expect(confirm).toBeDisabled()

    await user.type(screen.getByTestId('cancellation-decline-note-input'), '  \n ')
    expect(confirm).toBeDisabled()

    await user.type(
      screen.getByTestId('cancellation-decline-note-input'),
      'The days were already taken.',
    )
    await user.click(confirm)

    await waitFor(() => {
      expect(declineCall).toHaveBeenCalledWith(501, 'The days were already taken.')
    })
    expect(
      await screen.findByTestId('cancellation-decision-feedback'),
    ).toHaveTextContent('Cancellation declined for Sarah Chen.')
    // A decided card leaves the queue without waiting for the refetch to come back.
    expect(screen.queryByTestId('cancellation-card-501')).not.toBeInTheDocument()
  })

  it('[P0] approves once under StrictMode however many times the button is pressed', async () => {
    // CANCEL-UI-VAL-007 on the admin side: approving twice would restore the balance twice.
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([cancellation()])
    let resolveApprove: () => void = () => undefined
    const approveCall = vi
      .spyOn(apiClient, 'approveLeaveCancellation')
      .mockImplementation(
        () =>
          new Promise<LeaveRequestResponse>((resolve) => {
            resolveApprove = () => resolve({} as LeaveRequestResponse)
          }),
      )

    renderApprovals('ORGANIZATION_ADMIN', true)

    const approve = await screen.findByTestId('cancellation-approve-btn-501')
    await user.click(approve)
    expect(approve).toHaveAttribute('data-busy', 'true')
    expect(screen.getByTestId('cancellation-decline-btn-501')).toBeDisabled()

    await user.click(approve)
    expect(approveCall).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveApprove()
    })

    expect(
      await screen.findByTestId('cancellation-decision-feedback'),
    ).toHaveTextContent('Cancellation approved for Sarah Chen.')
  })

  it('[P1] keeps the card usable after a failed decision and shows the API’s reason', async () => {
    // The in-flight flag is released in a `finally`; releasing it only on success would strand the
    // card permanently disabled after one failure.
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([cancellation()])
    vi.spyOn(apiClient, 'approveLeaveCancellation').mockRejectedValue(
      new apiClient.ApiError(409, {
        type: 'https://leaveo.net/errors/cancellation-already-decided',
        title: 'Conflict',
        status: 409,
        detail: 'Someone else already decided this cancellation.',
      }),
    )

    renderApprovals('ORGANIZATION_ADMIN')

    await user.click(await screen.findByTestId('cancellation-approve-btn-501'))

    expect(
      await screen.findByTestId('cancellation-decision-feedback'),
    ).toHaveTextContent('Someone else already decided this cancellation.')
    expect(screen.getByTestId('cancellation-card-501')).toBeInTheDocument()
    expect(screen.getByTestId('cancellation-approve-btn-501')).toBeEnabled()
  })

  it('[P1] announces the empty queue rather than hiding the section', async () => {
    renderApprovals('ORGANIZATION_ADMIN')

    const empty = await screen.findByTestId('cancellations-empty-state')
    expect(empty).toHaveTextContent('No cancellation requests.')
    expect(screen.getByTestId('approvals-cancellations')).toBeInTheDocument()
  })

  it('[P1] renders the queue in Arabic with real text', async () => {
    // CANCEL-UI-VAL-009, admin half — a missing Arabic key would render blank, so name the text.
    await act(() => i18n.changeLanguage('ar'))
    vi.spyOn(apiClient, 'getPendingCancellations').mockResolvedValue([cancellation()])

    renderApprovals('ORGANIZATION_ADMIN')

    const card = await screen.findByTestId('cancellation-card-501')
    expect(within(card).getByTestId('cancellation-consequence-501')).toHaveTextContent(
      `الموافقة تعيد 3 أيام عمل إلى رصيد سنة ${isolate(2026)}.`,
    )
    expect(
      within(card).getByTestId('cancellation-approve-btn-501'),
    ).toHaveTextContent('الموافقة على الإلغاء')
  })
})
