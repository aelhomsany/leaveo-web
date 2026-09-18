import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isolate } from '../../i18n/bidi'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { LeaveTypeResponse, PreviewLeaveRequestResponse } from '../../api/generated/types'
import {
  AuthTestProvider,
  createMockAuthForRole,
  createMockAuthValue,
  mockUsers,
} from '../../test/authTestUtils'
import { mockLeaveRequestResponse, mockPreviewLeaveRequestResponse } from '../../test/apiFixtures'
import { mockBackdropGeometry } from '../../test/backdropTestUtils'
import { RequestLeaveModal } from './RequestLeaveModal'

const globalCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/global.css'),
  'utf8',
)

const mockLeaveTypes: LeaveTypeResponse[] = [
  {
    id: 1,
    publicId: 'public-1',
    name: 'Annual Leave',
    icon: '🌴',
    color: '#093C5D',
    backgroundColor: '#D6E8ED',
    borderColor: '#0E4F75',
    presenceType: 'OFF',
    defaultBalanceDays: 20,
    displayOrder: 1,
    active: true,
    halfDayAllowed: true,
  },
]

const mockPreviewFiveDays: PreviewLeaveRequestResponse = mockPreviewLeaveRequestResponse({
  workingDays: 5,
  chargedDays: 5,
  excludedWeekends: 2,
  excludedHolidays: 0,
  workforceGroupId: 1,
  workforceGroupName: 'US',
})

const mockPreviewZeroDays: PreviewLeaveRequestResponse = mockPreviewLeaveRequestResponse({
  workingDays: 0,
  chargedDays: 0,
  excludedWeekends: 2,
  excludedHolidays: 0,
  workforceGroupId: 1,
  workforceGroupName: 'US',
})

function renderModal(open = true, onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
        <RequestLeaveModal open={open} onClose={onClose} />
      </AuthTestProvider>
    </QueryClientProvider>,
  )
  return { ...result, onClose }
}

async function setLeaveDates(from: string, to: string) {
  fireEvent.change(screen.getByTestId('leave-from-date'), { target: { value: from } })
  fireEvent.change(screen.getByTestId('leave-to-date'), { target: { value: to } })
  await waitFor(() => {
    expect(screen.getByTestId('leave-from-date')).toHaveValue(from)
    expect(screen.getByTestId('leave-to-date')).toHaveValue(to)
  })
}

describe('RequestLeaveModal — Story 3.3', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[P0] disables submit and shows alert when preview returns zero working days', async () => {
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreviewZeroDays)
    const user = userEvent.setup()

    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-06-06', '2026-06-07')

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toHaveTextContent(/No working days/i)
      },
      { timeout: 2000 },
    )

    expect(screen.getByTestId('submit-request-btn')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(`${isolate('US')} Workforce Group`)
  })

  it('[P1] keeps shared disabled .btn CSS attached to disabled submit controls', async () => {
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreviewZeroDays)
    const user = userEvent.setup()

    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-06-06', '2026-06-07')

    await waitFor(() => {
      expect(screen.getByTestId('submit-request-btn')).toBeDisabled()
    })

    expect(screen.getByTestId('submit-request-btn')).toHaveClass('btn')
    expect(globalCss).toMatch(/\.btn:disabled\s*{[^}]*opacity:\s*\.55;[^}]*cursor:\s*not-allowed;/s)
    expect(globalCss).toMatch(/\.btn:disabled:hover\s*{[^}]*filter:\s*none;/s)
    expect(globalCss).toMatch(/\.btn:disabled:active\s*{[^}]*transform:\s*none;/s)
  })

  it('[P0] keeps the request form open and preserves input on backdrop click', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.type(screen.getByLabelText(/Note/i), 'Need coverage for a family trip')
    const dialog = screen.getByTestId('request-leave-modal')
    mockBackdropGeometry(dialog)

    fireEvent.click(dialog, { clientX: 20, clientY: 20 })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('request-leave-modal')).toBeInTheDocument()
    expect(screen.getByLabelText(/Note/i)).toHaveValue('Need coverage for a family trip')
  })

  it('[P1] still closes from Cancel and Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    const dialog = screen.getByTestId('request-leave-modal')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('[P1] renders charged-day preview copy and workforce group context', async () => {
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreviewFiveDays)
    const user = userEvent.setup()

    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-06-01', '2026-06-07')

    await waitFor(
      () => {
        expect(screen.getByTestId('working-day-preview')).toHaveTextContent(/5 working days will be charged/i)
      },
      { timeout: 2000 },
    )

    expect(screen.getByText(/Based on US Workforce Group weekends & holidays/i)).toBeInTheDocument()
    expect(screen.getByText(/2 weekend\/holiday days excluded from balance/i)).toBeInTheDocument()
    expect(screen.getByTestId('submit-request-btn')).toBeEnabled()
  })
})

describe('RequestLeaveModal — Story 3.4', () => {
  const mockCreateResponse = mockLeaveRequestResponse({
    id: 99,
    leaveTypeId: 1,
    dateFrom: '2026-06-01',
    dateTo: '2026-06-05',
    days: 5,
    status: 'PENDING',
    note: null,
    createdAt: '2026-06-13T10:00:00Z',
  })

  beforeEach(() => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreviewFiveDays)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[P1] calls createLeaveRequest and invokes onSuccess on happy path', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.spyOn(apiClient, 'createLeaveRequest').mockResolvedValue(mockCreateResponse)
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
          <RequestLeaveModal open onClose={onClose} onSuccess={onSuccess} />
        </AuthTestProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-06-01', '2026-06-07')
    await waitFor(() => expect(screen.getByTestId('submit-request-btn')).toBeEnabled())
    await user.click(screen.getByTestId('submit-request-btn'))

    await waitFor(() => {
      expect(apiClient.createLeaveRequest).toHaveBeenCalledWith({
        leaveTypeId: 1,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-07',
        startPart: 'FULL',
        endPart: 'FULL',
        note: undefined,
      })
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('[P1] Plan RESTO: translates an insufficient-balance refusal using the preview availability', async () => {
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue({
      ...mockPreviewFiveDays,
      balanceYear: 2026,
      availableDays: 2,
      currentDaysToUse: 5,
      carryoverDaysToUse: 0,
      carryoverExpiresOn: null,
    })
    vi.spyOn(apiClient, 'createLeaveRequest').mockRejectedValue(
      new apiClient.ApiError(400, {
        type: 'https://leaveo.net/errors/insufficient-balance',
        title: 'Insufficient Balance',
        status: 400,
        detail: 'Only 2 working days remaining for Annual Leave',
      }),
    )
    const user = userEvent.setup()

    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    await setLeaveDates('2026-06-01', '2026-06-07')
    await waitFor(() => expect(screen.getByTestId('submit-request-btn')).toBeEnabled())
    await user.click(screen.getByTestId('submit-request-btn'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Not enough days: only 2 days are available for this leave type.',
      )
    })
  })
})
describe('RequestLeaveModal — viewer has no workforce group', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderUngroupedModal() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    return render(
      <QueryClientProvider client={queryClient}>
        <AuthTestProvider
          value={createMockAuthValue({
            user: { ...mockUsers.organizationAdmin, workforceGroupName: null },
          })}
        >
          <RequestLeaveModal open onClose={vi.fn()} />
        </AuthTestProvider>
      </QueryClientProvider>,
    )
  }

  it('[P1] explains the missing group and blocks submit instead of previewing', async () => {
    const previewSpy = vi
      .spyOn(apiClient, 'previewLeaveRequest')
      .mockResolvedValue(mockPreviewFiveDays)

    renderUngroupedModal()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await setLeaveDates('2026-06-01', '2026-06-07')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not in a workforce group yet/i)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/Working Calendars/i)
    expect(screen.getByTestId('submit-request-btn')).toBeDisabled()
    // Retrying a request that is a guaranteed 400 is a dead end, so no retry is offered.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(previewSpy).not.toHaveBeenCalled()
  })

  it('[P1] previews as usual once the viewer belongs to a group', async () => {
    const previewSpy = vi
      .spyOn(apiClient, 'previewLeaveRequest')
      .mockResolvedValue(mockPreviewFiveDays)

    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Annual Leave/i })).toBeInTheDocument()
    })
    await setLeaveDates('2026-06-01', '2026-06-07')

    await waitFor(() => expect(previewSpy).toHaveBeenCalled())
    expect(screen.getByTestId('working-day-explainer')).not.toHaveAttribute(
      'data-state',
      'error',
    )
  })
})
