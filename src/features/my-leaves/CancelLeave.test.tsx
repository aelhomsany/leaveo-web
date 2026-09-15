import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type {
  CancellationRequestResponse,
  LeaveCancellationCapability,
  LeaveRequestResponse,
  RecentRequestResponse,
} from '../../api/generated/types'
import { ToastProvider } from '../../components/ui/ToastProvider'
import i18n from '../../i18n/config'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { MyLeavesPage } from './MyLeavesPage'

/**
 * Plan VUELTA / FR-56 — the requester's side of leave cancellation, at the SPA-only layer of the
 * Validation Pyramid. Every server rule (who may cancel, what "started" means, what the balance
 * does) is proved in the API integration tests; what only this layer can prove is that the page
 * renders the server's answer instead of computing its own, and that the modal's own guards hold.
 *
 * jsdom renders the desktop table and the mobile card list at once — CSS decides which is visible,
 * and CSS does not run here — so every row-level query is scoped to the desktop table.
 */

const NO_CANCELLATION: LeaveCancellationCapability = {
  cancellable: false,
  mode: 'NONE',
  blockedReason: null,
  daysToRestore: 0,
  daysForfeited: 0,
  reviewStatus: null,
}

function request(
  overrides: Partial<RecentRequestResponse> = {},
): RecentRequestResponse {
  return {
    id: 1,
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-03',
    workingDays: 3,
    status: 'APPROVED',
    statusHint: null,
    declineReason: null,
    approverFirstName: null,
    cancellation: NO_CANCELLATION,
    ...overrides,
  }
}

function selfService(daysToRestore: number): LeaveCancellationCapability {
  return {
    cancellable: true,
    mode: 'SELF_SERVICE',
    blockedReason: null,
    daysToRestore,
    daysForfeited: 0,
    reviewStatus: null,
  }
}

function adminReview(daysToRestore: number): LeaveCancellationCapability {
  return {
    cancellable: true,
    mode: 'ADMIN_REVIEW',
    blockedReason: null,
    daysToRestore,
    daysForfeited: 0,
    reviewStatus: null,
  }
}

function blocked(
  blockedReason: LeaveCancellationCapability['blockedReason'],
  reviewStatus: LeaveCancellationCapability['reviewStatus'] = null,
): LeaveCancellationCapability {
  return {
    cancellable: false,
    mode: 'NONE',
    blockedReason,
    daysToRestore: 0,
    daysForfeited: 0,
    reviewStatus,
  }
}

function renderMyLeaves(history: RecentRequestResponse[], strict = false) {
  vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(history)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const tree = (
    <MemoryRouter initialEntries={['/my-leaves']}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
            <MyLeavesPage />
          </AuthTestProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

/** The desktop row for `id`, once history has loaded. */
async function row(id: number) {
  return await screen.findByTestId(`my-leaves-request-row-${id}`)
}

async function clickCancel(user: ReturnType<typeof userEvent.setup>, id: number) {
  await user.click(within(await row(id)).getByTestId(`my-leaves-cancel-button-${id}`))
}

describe('My Leaves cancellation', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([])
    vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 0 })
    vi.spyOn(apiClient, 'getPendingCancellationCount').mockResolvedValue({ count: 0 })
    vi.spyOn(apiClient, 'getApprovalCapability').mockResolvedValue({
      canReviewApprovals: false,
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (i18n.language !== 'en') {
      await act(() => i18n.changeLanguage('en'))
    }
  })

  it('[P0] takes the action from cancellation.mode, never from the dates', async () => {
    // CANCEL-UI-VAL-001. The two rows are deliberately back to front: the row the server calls
    // self-service is dated in the past, and the row it sends to review is dated in the future.
    // Any client-side "has it started?" comparison would swap these two buttons.
    renderMyLeaves([
      request({
        id: 10,
        dateFrom: '2020-01-06',
        dateTo: '2020-01-08',
        cancellation: selfService(3),
      }),
      request({
        id: 11,
        dateFrom: '2099-01-06',
        dateTo: '2099-01-08',
        cancellation: adminReview(3),
      }),
    ])

    expect(
      within(await row(10)).getByTestId('my-leaves-cancel-button-10'),
    ).toHaveTextContent('Cancel Leave')
    expect(
      within(await row(11)).getByTestId('my-leaves-cancel-button-11'),
    ).toHaveTextContent('Request Cancellation')
  })

  it('[P1] promises nothing back when withdrawing, and names the days when cancelling', async () => {
    // CANCEL-UI-VAL-002. A PENDING request was never charged, so its copy must not offer days
    // back; an APPROVED one names the count the server says returns.
    const user = userEvent.setup()
    renderMyLeaves([
      request({ id: 20, status: 'PENDING', cancellation: selfService(0) }),
      request({ id: 21, status: 'APPROVED', cancellation: selfService(4) }),
    ])

    await clickCancel(user, 20)
    const withdrawBody = screen.getByTestId('cancel-leave-body')
    expect(withdrawBody).toHaveTextContent(
      'Nothing has been charged to your balance.',
    )
    expect(withdrawBody).not.toHaveTextContent(/back to your balance/)
    expect(screen.getByTestId('cancel-confirm-btn')).toHaveTextContent(
      'Withdraw Request',
    )
    await user.click(screen.getByTestId('cancel-dismiss-btn'))

    await clickCancel(user, 21)
    expect(screen.getByTestId('cancel-leave-body')).toHaveTextContent(
      '4 working days go back to your balance.',
    )
  })

  it('[P1] Plan RESTO: names carried days that expired and will not come back when cancelling', async () => {
    const user = userEvent.setup()
    renderMyLeaves([
      request({ id: 22, status: 'APPROVED', cancellation: { ...selfService(2), daysForfeited: 1 } }),
    ])

    await clickCancel(user, 22)
    const body = screen.getByTestId('cancel-leave-body')
    expect(body).toHaveTextContent('2 working days go back to your balance.')
    expect(body).toHaveTextContent('1 carried day is not returned because it has expired.')
  })

  it('[P0] blocks the review modal until a reason is typed', async () => {
    // CANCEL-UI-VAL-003. The API requires 1–500 characters; this is the client half — the confirm
    // button never dispatches an empty (or whitespace-only) reason in the first place.
    const user = userEvent.setup()
    const requestReview = vi
      .spyOn(apiClient, 'requestLeaveCancellation')
      // The page ignores the mutation payload — only that it settles matters here.
      .mockResolvedValue({} as CancellationRequestResponse)
    renderMyLeaves([request({ id: 30, cancellation: adminReview(2) })])

    await clickCancel(user, 30)
    const confirm = screen.getByTestId('cancel-confirm-btn')
    expect(confirm).toBeDisabled()

    await user.type(screen.getByTestId('cancel-reason-input'), '   ')
    expect(confirm).toBeDisabled()

    await user.type(screen.getByTestId('cancel-reason-input'), 'Came back early')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => {
      expect(requestReview).toHaveBeenCalledWith(30, 'Came back early')
    })
  })

  it('[P1] explains a closed balance year instead of offering a button that always fails', async () => {
    // CANCEL-UI-VAL-004.
    renderMyLeaves([
      request({ id: 40, cancellation: blocked('PRIOR_BALANCE_YEAR') }),
    ])

    const scope = within(await row(40))
    expect(scope.getByTestId('cancellation-prior-year-note')).toHaveTextContent(
      'closed balance year',
    )
    expect(
      scope.queryByTestId('my-leaves-cancel-button-40'),
    ).not.toBeInTheDocument()
  })

  it('[P1] shows an open review as a state, not as a second Cancel button', async () => {
    renderMyLeaves([
      request({ id: 41, cancellation: blocked('REVIEW_PENDING', 'PENDING') }),
    ])

    const scope = within(await row(41))
    expect(scope.getByTestId('cancellation-pending-note')).toHaveTextContent(
      'Cancellation requested',
    )
    expect(
      scope.queryByTestId('my-leaves-cancel-button-41'),
    ).not.toBeInTheDocument()
  })

  it('[P1] renders the terminal Cancelled badge and its filter segment', async () => {
    // CANCEL-UI-VAL-005. The badge takes its colour from the global.css status modifier, and
    // Cancelled is a first-class segment of the status filter.
    renderMyLeaves([request({ id: 50, status: 'CANCELLED' })])

    const badge = within(await row(50)).getByText('Cancelled')
    expect(badge).toHaveClass('badge', 'badge-cancelled')
    expect(
      within(screen.getByTestId('my-leaves-status-filter')).getByRole('button', {
        name: 'Cancelled',
      }),
    ).toBeInTheDocument()
  })

  it('[P0] leaves its in-flight state under StrictMode and submits exactly once', async () => {
    // CANCEL-UI-VAL-007. React Query's `isPending` stalls under StrictMode's double-invoke, which
    // is why the page owns the flag in its own state. The ref guard plus the disabled button are
    // what make a second press a no-op.
    const user = userEvent.setup()
    let resolveCancel: () => void = () => undefined
    const cancel = vi
      .spyOn(apiClient, 'cancelLeaveRequest')
      .mockImplementation(
        () =>
          new Promise<LeaveRequestResponse>((resolve) => {
            resolveCancel = () => resolve({} as LeaveRequestResponse)
          }),
      )
    renderMyLeaves([request({ id: 60, cancellation: selfService(3) })], true)

    await clickCancel(user, 60)
    const confirm = screen.getByTestId('cancel-confirm-btn')
    await user.click(confirm)
    expect(confirm).toHaveAttribute('data-busy', 'true')

    // A second press while the first is in flight must not reach the API.
    await user.click(confirm)
    expect(cancel).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveCancel()
    })

    // The dialog closes and the toast names what came back — the busy state does not survive the
    // resolved promise, which is the failure StrictMode used to hide.
    await waitFor(() => {
      expect(screen.queryByTestId('cancel-leave-modal')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('app-toast')).toHaveTextContent(
      'Leave cancelled. 3 working days are back in your balance.',
    )
  })

  it('[P1] surfaces the API problem detail rather than a generic retry line', async () => {
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'cancelLeaveRequest').mockRejectedValue(
      new apiClient.ApiError(409, {
        type: 'https://leaveo.net/errors/cancellation-requires-review',
        title: 'Conflict',
        status: 409,
        detail: 'This leave has already started; ask your Organization Admin.',
      }),
    )
    renderMyLeaves([request({ id: 70, cancellation: selfService(3) })])

    await clickCancel(user, 70)
    await user.click(screen.getByTestId('cancel-confirm-btn'))

    expect(await screen.findByTestId('cancel-submit-error')).toHaveTextContent(
      'This leave has already started; ask your Organization Admin.',
    )
    // The dialog stays open so the person can read the reason and back out deliberately.
    expect(screen.getByTestId('cancel-leave-modal')).toBeInTheDocument()
  })

  it('[P1] renders the badge and both modals in Arabic', async () => {
    // CANCEL-UI-VAL-009. `parseMissingKeyHandler` returns '' in this app, so a missing Arabic key
    // renders blank and still passes `toBeVisible()` — these assertions name real text instead,
    // including the `few` plural Arabic needs for 3.
    const user = userEvent.setup()
    await act(() => i18n.changeLanguage('ar'))
    renderMyLeaves([
      request({ id: 80, status: 'CANCELLED' }),
      request({ id: 81, status: 'APPROVED', cancellation: selfService(3) }),
      request({ id: 82, status: 'APPROVED', cancellation: adminReview(3) }),
    ])

    expect(within(await row(80)).getByText('ملغى')).toHaveClass('badge-cancelled')

    await clickCancel(user, 81)
    expect(screen.getByTestId('cancel-leave-body')).toHaveTextContent(
      'تعود 3 أيام عمل إلى رصيدك.',
    )
    await user.click(screen.getByTestId('cancel-dismiss-btn'))

    await clickCancel(user, 82)
    expect(screen.getByTestId('cancel-leave-body')).toHaveTextContent(
      'بدأت هذه الإجازة بالفعل.',
    )
    expect(screen.getByTestId('cancel-confirm-btn')).toHaveTextContent('إرسال الطلب')
  })
})
