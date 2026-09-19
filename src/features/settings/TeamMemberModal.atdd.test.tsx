import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type {
  LeaveTypeResponse,
  TeamMemberSummaryResponse,
  WorkforceGroupResponse,
} from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockWorkforceGroup } from '../../test/apiFixtures'
import { TeamMemberModal } from './TeamMemberModal'
import { MemoryRouter } from 'react-router-dom'

const mockGroups: WorkforceGroupResponse[] = [
  mockWorkforceGroup({ id: 1, name: 'US' }),
]

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

const mockMembers: TeamMemberSummaryResponse[] = []

function renderModal(onClose = vi.fn()) {
  vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(mockGroups)
  vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
  vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
          <TeamMemberModal
            editMemberId={null}
            onClose={onClose}
            onSuccess={vi.fn()}
            onWarning={vi.fn()}
          />
        </AuthTestProvider>
      </MemoryRouter>
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

describe('TeamMemberModal ATDD — Story 10.2 shared control states', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test.skip('[P0] backdrop click keeps the team-member form open and preserves unsaved input', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await user.type(screen.getByLabelText(/Full name/i), 'Jordan Lee')
    await user.type(screen.getByLabelText(/Email/i), 'jordan@example.com')
    const dialog = screen.getByRole('dialog', { name: 'Add Team Member' })
    mockBackdropGeometry(dialog)

    fireEvent.click(dialog, { clientX: 20, clientY: 20 })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add Team Member' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Full name/i)).toHaveValue('Jordan Lee')
    expect(screen.getByLabelText(/Email/i)).toHaveValue('jordan@example.com')
  })
})
