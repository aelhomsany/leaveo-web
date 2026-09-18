import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { LeaveTypeResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { RequestLeaveModal } from './RequestLeaveModal'

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

function renderModal(onClose = vi.fn()) {
  vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
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

function mockBackdropGeometry(dialog: HTMLElement) {
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 100,
    top: 100,
    left: 100,
    right: 500,
    bottom: 500,
    width: 400,
    height: 400,
    toJSON: () => ({}),
  })
}

describe('RequestLeaveModal ATDD — Story 10.2 shared control states', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test.skip('[P0] backdrop click keeps the request form open and preserves unsaved input', async () => {
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
})
