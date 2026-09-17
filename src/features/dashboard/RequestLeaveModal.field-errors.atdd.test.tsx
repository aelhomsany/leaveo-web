import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import { ApiError } from '../../api/client'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import type { PreviewLeaveRequestResponse, ProblemDetail } from '../../api/generated/types'
import i18n from '../../i18n/config'
import { RequestLeaveModal } from './RequestLeaveModal'

const mockLeaveTypes = [
  {
    id: 1,
    name: 'Annual Leave',
    icon: '🌴',
    color: '#093C5D',
    backgroundColor: '#D6E8ED',
    borderColor: '#0E4F75',
    defaultBalanceDays: 20,
    displayOrder: 1,
  },
]

function renderModal(onClose = vi.fn()) {
  vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
  vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue({
    workingDays: 2,
    chargedDays: 2,
    excludedWeekends: 0,
    excludedHolidays: 0,
    workforceGroupName: 'US',
  } satisfies PreviewLeaveRequestResponse)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
        <RequestLeaveModal open onClose={onClose} />
      </AuthTestProvider>
    </QueryClientProvider>,
  )

  return { onClose }
}

async function setLeaveDates(from: string, to: string) {
  fireEvent.change(screen.getByTestId('leave-from-date'), { target: { value: from } })
  fireEvent.change(screen.getByTestId('leave-to-date'), { target: { value: to } })
  await waitFor(() => {
    expect(screen.getByTestId('leave-from-date')).toHaveValue(from)
    expect(screen.getByTestId('leave-to-date')).toHaveValue(to)
  })
}

describe('RequestLeaveModal ATDD - Story 10.4 field-level server validation', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
  })

  it('[P0] renders inline field errors and marks the matching date inputs aria-invalid', async () => {
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'createLeaveRequest').mockRejectedValue(
      new ApiError(400, {
        status: 400,
        title: 'Validation failed',
        detail: 'Request failed validation',
        type: 'https://leaveo.net/errors/validation-failed',
        violations: [
          { field: 'leaveTypeId', message: 'Leave type is required' },
          { field: 'dateFrom', message: 'Start date is required' },
          { field: 'dateTo', message: 'End date is required' },
        ],
      } satisfies ProblemDetail),
    )

    renderModal()

    await waitFor(() => {
      expect(screen.getByTestId('request-leave-modal')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-06-10', '2026-06-12')
    await waitFor(() => {
      expect(screen.getByTestId('submit-request-btn')).toBeEnabled()
    })
    await user.click(screen.getByTestId('submit-request-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('field-error-leave-type')).toHaveTextContent(
        'Leave type is required',
      )
    })

    expect(screen.getByTestId('field-error-leave-from-date')).toHaveTextContent(
      'Start date is required',
    )
    expect(screen.getByTestId('field-error-leave-to-date')).toHaveTextContent(
      'End date is required',
    )
    expect(screen.getByLabelText(/Leave Type/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/From date/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/To date/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('[P1] keeps the generic block alert path for non-field validation failures', async () => {
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'createLeaveRequest').mockRejectedValue(
      new ApiError(400, {
        status: 400,
        title: 'Validation failed',
        detail: 'The selected range has no working days',
        type: 'https://leaveo.net/errors/validation-failed',
      } satisfies ProblemDetail),
    )

    renderModal()

    await waitFor(() => {
      expect(screen.getByTestId('request-leave-modal')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-06-10', '2026-06-12')
    await waitFor(() => {
      expect(screen.getByTestId('submit-request-btn')).toBeEnabled()
    })
    await user.click(screen.getByTestId('submit-request-btn'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('The selected range has no working days')
    })

    expect(screen.queryByTestId('field-error-leave-type')).not.toBeInTheDocument()
    expect(screen.queryByTestId('field-error-leave-from-date')).not.toBeInTheDocument()
    expect(screen.queryByTestId('field-error-leave-to-date')).not.toBeInTheDocument()
  })

  it('[Story 9.4] translates known field violations under the Arabic locale, falling back to the raw message for unmapped fields', async () => {
    await i18n.changeLanguage('ar')
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'createLeaveRequest').mockRejectedValue(
      new ApiError(400, {
        status: 400,
        title: 'Validation failed',
        detail: 'Request failed validation',
        type: 'https://leaveo.net/errors/validation-failed',
        violations: [
          { field: 'leaveTypeId', message: 'must not be null' },
          { field: 'dateTo', message: 'dateTo must be on or after dateFrom' },
          { field: 'dateFrom', message: 'Start date is required' },
        ],
      } satisfies ProblemDetail),
    )

    renderModal()

    await waitFor(() => {
      expect(screen.getByTestId('request-leave-modal')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText(/نوع الإجازة/i), '1')
    await setLeaveDates('2026-06-10', '2026-06-12')
    await waitFor(() => {
      expect(screen.getByTestId('submit-request-btn')).toBeEnabled()
    })
    await user.click(screen.getByTestId('submit-request-btn'))

    // Mapped fields render the Arabic translation, not the raw English server message.
    await waitFor(() => {
      expect(screen.getByTestId('field-error-leave-type')).toHaveTextContent('اختر نوع الإجازة')
    })
    expect(screen.getByTestId('field-error-leave-to-date')).toHaveTextContent(
      'يجب أن يكون تاريخ الانتهاء في تاريخ البدء أو بعده',
    )
    // dateFrom has no entry in the field-violation translation map (by design,
    // matching the story's minimum table) — the raw server message passes through.
    expect(screen.getByTestId('field-error-leave-from-date')).toHaveTextContent(
      'Start date is required',
    )
  })
})
