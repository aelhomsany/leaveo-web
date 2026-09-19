import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import { ApiError } from '../../api/client'
import type {
  BalanceCorrectionListPage,
  BalanceCorrectionPreviewResponse,
  BalanceCorrectionResponse,
  PolicySettingsOverviewResponse,
} from '../../api/generated/types'
import { ToastProvider } from '../../components/ui/ToastProvider'
import '../../i18n/config'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { CorrectionsPage } from './CorrectionsPage'

function overview(): PolicySettingsOverviewResponse {
  return {
    leaveTypes: [
      {
        leaveTypePublicId: 'lt-1',
        name: 'Annual Leave',
        icon: 'palm',
        color: '#000',
        backgroundColor: '#fff',
        borderColor: '#000',
        presenceType: 'OFF',
        defaultBalanceDays: 20,
        displayOrder: 1,
        active: true,
        policyPublicId: 'p-1',
        latestDraft: undefined,
      },
    ],
    users: [{ publicId: 'user-1', name: 'Jordan Lee' }],
    workforceGroups: [],
  } as unknown as PolicySettingsOverviewResponse
}

function ledgerPage(items: BalanceCorrectionListPage['items'] = []): BalanceCorrectionListPage {
  return { items, page: 0, size: 50, total: items?.length ?? 0 } as BalanceCorrectionListPage
}

function preview(
  overrides: Partial<BalanceCorrectionPreviewResponse> = {},
): BalanceCorrectionPreviewResponse {
  return {
    userPublicId: 'user-1',
    leaveTypePublicId: 'lt-1',
    balanceYear: 2026,
    beforeRemainingDays: 20,
    deltaDays: -2,
    afterRemainingDays: 18,
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
            <CorrectionsPage />
          </AuthTestProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('CorrectionsPage', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getPolicySettingsOverview').mockResolvedValue(overview())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // CORRECTION-UI-VAL-001: form -> confirm preview -> record shows before/after evidence from
  // the response, not a client-computed guess.
  it('reviews and records a correction, then shows the before/after result', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue(ledgerPage())
    vi.spyOn(apiClient, 'previewBalanceCorrection').mockResolvedValue(preview())
    vi.spyOn(apiClient, 'recordBalanceCorrection').mockResolvedValue({
      id: 1,
      kind: 'MANUAL_CORRECTION',
      userPublicId: 'user-1',
      leaveTypePublicId: 'lt-1',
      balanceYear: 2026,
      deltaDays: -2,
      reason: 'Overpaid days',
      effectiveDate: '2026-08-20',
      actorUserPublicId: 'user-5',
      createdAt: '2026-08-27T00:00:00Z',
      beforeRemainingDays: 20,
      afterRemainingDays: 18,
      compensationOfId: null,
      notificationRequested: false,
      notificationSent: false,
    })

    const user = userEvent.setup()
    renderPage()

    await screen.findByTestId('correction-form')
    await screen.findByText('Jordan Lee')
    await user.selectOptions(screen.getByLabelText(/^person$/i), 'user-1')
    await user.selectOptions(screen.getByLabelText(/leave type/i), 'lt-1')
    await user.type(screen.getByLabelText(/delta \(days\)/i), '-2')
    await user.type(screen.getByLabelText(/^reason$/i), 'Overpaid days')
    await user.type(screen.getByLabelText(/effective date/i), '2026-08-20')
    await user.click(screen.getByRole('button', { name: /review correction/i }))

    const modal = await screen.findByRole('dialog')
    // UX-DR72 / AC2: the server-computed before, signed adjustment and resulting value are on
    // screen BEFORE the confirm button is usable.
    await within(modal).findByTestId('correction-preview')
    expect(within(modal).getByTestId('correction-preview-before')).toHaveTextContent('20')
    expect(within(modal).getByTestId('correction-preview-delta')).toHaveTextContent('-2')
    expect(within(modal).getByTestId('correction-preview-after')).toHaveTextContent('18')
    await user.click(within(modal).getByRole('button', { name: /^record correction$/i }))

    const resultSection = await screen.findByTestId('correction-result')
    expect(within(resultSection).getByText('20')).toBeInTheDocument()
    expect(within(resultSection).getByText('18')).toBeInTheDocument()
  })

  // CORRECTION-UI-VAL-002: the compensate action disables for that row immediately after a
  // successful compensation, rather than depending on a second click's 409.
  it('disables the compensate action for a row after it is compensated', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue(
      ledgerPage([
        {
          id: 42,
          kind: 'MANUAL_CORRECTION',
          userPublicId: 'user-1',
          leaveTypePublicId: 'lt-1',
          balanceYear: 2026,
          deltaDays: -2,
          reason: 'Overpaid days',
          effectiveDate: '2026-08-20',
          actorUserPublicId: 'user-5',
          createdAt: '2026-08-27T00:00:00Z',
          compensationOfId: undefined,
          compensated: false,
        },
      ]),
    )
    vi.spyOn(apiClient, 'compensateBalanceCorrection').mockResolvedValue({
      id: 43,
      kind: 'COMPENSATION',
      compensationOfId: 42,
    } as BalanceCorrectionResponse)

    const user = userEvent.setup()
    renderPage()

    const compensateButton = await screen.findByTestId('correction-compensate-42')
    await user.click(compensateButton)

    const modal = await screen.findByRole('dialog')
    await user.type(within(modal).getByLabelText(/^reason$/i), 'Reversal')
    await user.type(within(modal).getByLabelText(/effective date/i), '2026-08-21')
    await user.click(within(modal).getByRole('button', { name: /confirm compensation/i }))

    await waitFor(() => expect(screen.getByTestId('correction-compensated-42')).toBeInTheDocument())
    expect(screen.queryByTestId('correction-compensate-42')).not.toBeInTheDocument()
  })

  // CORRECTION-UI-VAL-003: capability-unavailable renders distinct copy with no dead retry.
  it('shows a capability-unavailable banner with no retry when corrections are denied', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockRejectedValue(
      new ApiError(403, { status: 403, code: 'capability-unavailable', title: 'Forbidden', detail: 'nope' }),
    )

    renderPage()

    const banner = await screen.findByTestId('corrections-capability-unavailable')
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('correction-form')).not.toBeInTheDocument()
  })

  // CORRECTION-UI-VAL-004 (Story 15.5 D1): a failed preview must never leave a blind confirm —
  // the modal says so and the write button stays disabled.
  it('blocks the confirm when the balance preview fails', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue(ledgerPage())
    vi.spyOn(apiClient, 'previewBalanceCorrection').mockRejectedValue(
      new ApiError(500, { status: 500, code: 'internal', title: 'Error', detail: 'boom' }),
    )
    const recordSpy = vi.spyOn(apiClient, 'recordBalanceCorrection')

    const user = userEvent.setup()
    renderPage()

    await screen.findByTestId('correction-form')
    await screen.findByText('Jordan Lee')
    await user.selectOptions(screen.getByLabelText(/^person$/i), 'user-1')
    await user.selectOptions(screen.getByLabelText(/leave type/i), 'lt-1')
    await user.type(screen.getByLabelText(/delta \(days\)/i), '-2')
    await user.type(screen.getByLabelText(/^reason$/i), 'Overpaid days')
    await user.type(screen.getByLabelText(/effective date/i), '2026-08-20')
    await user.click(screen.getByRole('button', { name: /review correction/i }))

    const modal = await screen.findByRole('dialog')
    await within(modal).findByTestId('correction-preview-error')
    expect(within(modal).getByRole('button', { name: /^record correction$/i })).toBeDisabled()
    expect(recordSpy).not.toHaveBeenCalled()
  })

  // CORRECTION-UI-VAL-005: `deltaDays` is an `int` server-side and a zero adjustment is a no-op;
  // `step="1"` cannot enforce either because the form sets `noValidate`.
  it('rejects a zero or fractional delta before opening the confirm', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue(ledgerPage())
    const previewSpy = vi.spyOn(apiClient, 'previewBalanceCorrection')

    const user = userEvent.setup()
    renderPage()

    await screen.findByTestId('correction-form')
    await screen.findByText('Jordan Lee')
    await user.selectOptions(screen.getByLabelText(/^person$/i), 'user-1')
    await user.selectOptions(screen.getByLabelText(/leave type/i), 'lt-1')
    await user.type(screen.getByLabelText(/^reason$/i), 'Overpaid days')
    await user.type(screen.getByLabelText(/effective date/i), '2026-08-20')

    const delta = screen.getByLabelText(/delta \(days\)/i)
    await user.type(delta, '0')
    await user.click(screen.getByRole('button', { name: /review correction/i }))
    expect(await screen.findByText(/whole number of days other than zero/i)).toBeInTheDocument()

    await user.clear(delta)
    await user.type(delta, '1.5')
    await user.click(screen.getByRole('button', { name: /review correction/i }))
    expect(screen.getByText(/whole number of days other than zero/i)).toBeInTheDocument()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(previewSpy).not.toHaveBeenCalled()
  })

  // CORRECTION-UI-VAL-006: a transport failure must not claim the entry was already compensated.
  it('does not claim "already compensated" for a network failure', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue(
      ledgerPage([
        {
          id: 42,
          kind: 'MANUAL_CORRECTION',
          userPublicId: 'user-1',
          leaveTypePublicId: 'lt-1',
          balanceYear: 2026,
          deltaDays: -2,
          reason: 'Overpaid days',
          effectiveDate: '2026-08-20',
          actorUserPublicId: 'user-5',
          createdAt: '2026-08-27T00:00:00Z',
          compensationOfId: undefined,
          compensated: false,
        },
      ]),
    )
    vi.spyOn(apiClient, 'compensateBalanceCorrection').mockRejectedValue(new TypeError('Failed to fetch'))

    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByTestId('correction-compensate-42'))
    const modal = await screen.findByRole('dialog')
    await user.type(within(modal).getByLabelText(/^reason$/i), 'Reversal')
    await user.type(within(modal).getByLabelText(/effective date/i), '2026-08-21')
    await user.click(within(modal).getByRole('button', { name: /confirm compensation/i }))

    expect(await within(modal).findByText(/could not compensate this entry/i)).toBeInTheDocument()
    expect(within(modal).queryByText(/already compensated/i)).not.toBeInTheDocument()
  })

  // CORRECTION-UI-VAL-007: a permanently gated capability shows the banner, not a retryable error.
  it('shows the capability banner when compensation is capability-denied', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue(
      ledgerPage([
        {
          id: 42,
          kind: 'MANUAL_CORRECTION',
          userPublicId: 'user-1',
          leaveTypePublicId: 'lt-1',
          balanceYear: 2026,
          deltaDays: -2,
          reason: 'Overpaid days',
          effectiveDate: '2026-08-20',
          actorUserPublicId: 'user-5',
          createdAt: '2026-08-27T00:00:00Z',
          compensationOfId: undefined,
          compensated: false,
        },
      ]),
    )
    vi.spyOn(apiClient, 'compensateBalanceCorrection').mockRejectedValue(
      new ApiError(403, { status: 403, code: 'capability-unavailable', title: 'Forbidden', detail: undefined }),
    )

    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByTestId('correction-compensate-42'))
    const modal = await screen.findByRole('dialog')
    await user.type(within(modal).getByLabelText(/^reason$/i), 'Reversal')
    await user.type(within(modal).getByLabelText(/effective date/i), '2026-08-21')
    await user.click(within(modal).getByRole('button', { name: /confirm compensation/i }))

    expect(await screen.findByTestId('corrections-capability-unavailable')).toBeInTheDocument()
  })

  // CORRECTION-UI-VAL-008: the ledger paginates rather than silently truncating, and the total is
  // announced so older entries are reachable and countable.
  it('paginates the ledger and reports the total', async () => {
    const listSpy = vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue({
      items: [
        {
          id: 1,
          kind: 'MANUAL_CORRECTION',
          userPublicId: 'user-1',
          leaveTypePublicId: 'lt-1',
          balanceYear: 2026,
          deltaDays: -2,
          reason: 'Overpaid days',
          effectiveDate: '2026-08-20',
          actorUserPublicId: 'user-5',
          createdAt: '2026-08-27T00:00:00Z',
          compensated: false,
        },
      ],
      page: 0,
      size: 50,
      total: 120,
    } as BalanceCorrectionListPage)

    const user = userEvent.setup()
    renderPage()

    const status = await screen.findByTestId('correction-ledger-pagination-status')
    await waitFor(() => expect(status).toHaveTextContent('120'))
    expect(status).toHaveTextContent('Page 1 of 3')
    expect(status).toHaveAttribute('aria-live', 'polite')

    await user.click(screen.getByTestId('correction-ledger-next'))
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith(undefined, undefined, 1, 50))
  })

  // The ledger band must report the SERVER's total, not the number of rows this page happens
  // to be showing. Ninety entries over a 50-row page is the case where a client-side count
  // would silently disagree with the pager two lines below it.
  it('reports the paged response total and page count in the ledger band', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue({
      items: [
        {
          id: 1,
          kind: 'MANUAL_CORRECTION',
          userPublicId: 'user-1',
          leaveTypePublicId: 'lt-1',
          deltaDays: 3,
          reason: 'Carried over',
          effectiveDate: '2026-01-01',
          compensated: false,
        },
      ],
      page: 0,
      size: 50,
      total: 90,
    } as unknown as BalanceCorrectionListPage)

    renderPage()

    const band = await screen.findByTestId('corrections-ledger-band')
    // Screens render before their queries resolve; the em dash is the pre-data state.
    await waitFor(() =>
      expect(within(band).getByTestId('corrections-ledger-entries')).toHaveTextContent('90'),
    )
    expect(within(band).getByTestId('corrections-ledger-pages')).toHaveTextContent('2')

    // Scoped with within(): "Compensate" and the leave type name are also in the table below.
    expect(within(band).getByText(/what a correction does/i)).toBeInTheDocument()
    expect(
      within(band).getByText(/compensate appends the exact opposite entry/i),
    ).toBeInTheDocument()
  })

  // A failed ledger load must not let the band assert a confident "0 entries" — that reads as
  // a clean audit trail when what actually happened is that nobody could read it.
  it('shows no ledger figures while the ledger is unavailable', async () => {
    vi.spyOn(apiClient, 'listBalanceCorrections').mockRejectedValue(
      new ApiError(500, { status: 500, code: 'internal', title: 'Error', detail: 'boom' }),
    )

    renderPage()

    const band = await screen.findByTestId('corrections-ledger-band')
    await waitFor(() =>
      expect(within(band).getByTestId('corrections-ledger-entries')).toHaveTextContent('—'),
    )
    expect(within(band).getByTestId('corrections-ledger-pages')).toHaveTextContent('—')
  })

  // CORRECTION-UI-VAL-009: a failed reference load must say so rather than leaving two empty
  // selects with no explanation.
  it('surfaces a reference-data load failure', async () => {
    vi.restoreAllMocks()
    vi.spyOn(apiClient, 'getPolicySettingsOverview').mockRejectedValue(
      new ApiError(500, { status: 500, code: 'internal', title: 'Error', detail: 'boom' }),
    )
    vi.spyOn(apiClient, 'listBalanceCorrections').mockResolvedValue(ledgerPage())

    renderPage()

    expect(await screen.findByTestId('correction-reference-error')).toBeInTheDocument()
  })
})
