import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import * as apiClient from '../../api/client'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockPreviewLeaveRequestResponse } from '../../test/apiFixtures'
import { createTestQueryClient } from '../../test/queryClient'
import { RequestLeaveModal } from './RequestLeaveModal'

describe('RequestLeaveModal query feedback ATDD — Story 10.8', () => {
  test('[P1] disables the submit control and marks it busy while the leave mutation is pending', async () => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue([
      {
        id: 1,
        publicId: 'public-1',
        name: 'Annual Leave',
        icon: 'leave',
        color: '#093C5D',
        backgroundColor: '#D6E8ED',
        borderColor: '#0E4F75',
        presenceType: 'OFF',
        defaultBalanceDays: 20,
        displayOrder: 1,
        active: true,
        halfDayAllowed: true,
      },
    ])
    vi.spyOn(apiClient, 'previewLeaveRequest').mockResolvedValue(mockPreviewLeaveRequestResponse({
      workingDays: 5,
      excludedWeekends: 2,
      excludedHolidays: 0,
      workforceGroupId: 1,
      workforceGroupName: 'US',
    }))
    vi.spyOn(apiClient, 'createLeaveRequest').mockImplementation(
      () => new Promise(() => undefined),
    )

    const user = userEvent.setup()
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
          <RequestLeaveModal open onClose={vi.fn()} />
        </AuthTestProvider>
      </QueryClientProvider>,
    )

    await screen.findByRole('option', { name: /Annual Leave/ })
    await user.selectOptions(screen.getByLabelText(/Leave Type/i), '1')
    fireEvent.change(screen.getByTestId('leave-from-date'), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByTestId('leave-to-date'), { target: { value: '2026-08-07' } })

    const submit = screen.getByTestId('submit-request-btn')
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    await waitFor(() => {
      expect(submit).toBeDisabled()
      expect(submit).toHaveAttribute('data-busy', 'true')
    })
  })
})
