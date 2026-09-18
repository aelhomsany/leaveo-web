import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { PreviewLeaveRequestResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { RequestLeaveModal } from './RequestLeaveModal'

/**
 * Story 11.1 — RequestLeaveModal shared WorkingDayExplainer integration.
 */

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

const mockPreviewFiveDays: PreviewLeaveRequestResponse = {
  workingDays: 5,
  chargedDays: 5,
  excludedWeekends: 2,
  excludedHolidays: 0,
  workforceGroupId: 1,
  workforceGroupName: 'US',
}

const mockPreviewZeroDays: PreviewLeaveRequestResponse = {
  workingDays: 0,
  chargedDays: 0,
  excludedWeekends: 2,
  excludedHolidays: 0,
  workforceGroupId: 1,
  workforceGroupName: 'US',
}

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
        <RequestLeaveModal open onClose={vi.fn()} />
      </AuthTestProvider>
    </QueryClientProvider>,
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

describe('RequestLeaveModal Coastal ATDD — Story 11.1', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[P0] preview region mounts WorkingDayExplainer (shared contract testids)', async () => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreviewFiveDays)

    renderModal()
    await setLeaveDates('2026-08-10', '2026-08-14')

    await waitFor(() => {
      expect(screen.getByTestId('working-day-result')).toHaveTextContent(
        /5\s+working\s+days/i,
      )
    })

    // Shared explainer owns the durable preview surface inside working-day-preview.
    expect(screen.getByTestId('working-day-preview')).toContainElement(
      screen.getByTestId('working-day-explainer'),
    )
    expect(screen.getByTestId('working-day-policy')).toHaveTextContent(/US/i)
  })

  it('[P0] zero working days keeps Submit blocked after explainer migration', async () => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreviewZeroDays)

    renderModal()
    await setLeaveDates('2026-08-15', '2026-08-16')

    await waitFor(() => {
      expect(screen.getByTestId('working-day-result')).toHaveTextContent(/No working days/i)
    })

    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })

  it('[P0] preview failure never shows a stale working-day total', async () => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'previewLeaveRequest').mockRejectedValue(new Error('preview failed'))

    renderModal()
    await setLeaveDates('2026-08-10', '2026-08-14')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('working-day-result')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })
})
