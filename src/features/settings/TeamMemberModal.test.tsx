import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ApiError } from '../../api/client'
import * as apiClient from '../../api/client'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockBackdropGeometry } from '../../test/backdropTestUtils'
import { mockTeamMemberDetail, mockTeamMemberSummary } from '../../test/apiFixtures'
import { redirectToExternalUrl } from '../../navigation/redirect'
import i18n from '../../i18n/config'
import { TeamMemberModal } from './TeamMemberModal'
import type {
  LeaveTypeResponse,
  TeamMemberDetailResponse,
  TeamMemberSummaryResponse,
  WorkforceGroupResponse,
} from '../../api/generated/types'
import { MemoryRouter, useLocation } from 'react-router-dom'

vi.mock('../../navigation/redirect', () => ({
  redirectToExternalUrl: vi.fn(),
}))

const mockGroups: WorkforceGroupResponse[] = [
  {
    id: 1,
    name: 'US',
    timezone: 'America/New_York',
    weekendDays: ['SATURDAY', 'SUNDAY'],
    currentEffectiveFrom: '2026-01-01',
    scheduledChanges: [],
    overrideCount: 0,
  },
  {
    id: 2,
    name: 'Egypt',
    timezone: 'Africa/Cairo',
    weekendDays: ['FRIDAY', 'SATURDAY'],
    currentEffectiveFrom: '2026-01-01',
    scheduledChanges: [],
    overrideCount: 0,
  },
]

const mockLeaveTypes: LeaveTypeResponse[] = [
  { id: 1, publicId: 'lt-annual', name: 'Annual Leave', icon: '🌴', color: '#093C5D', backgroundColor: '#D6E8ED', borderColor: '#0E4F75', presenceType: 'OFF', defaultBalanceDays: 20, displayOrder: 1, active: true, halfDayAllowed: true },
  { id: 2, publicId: 'lt-sick', name: 'Sick Leave', icon: '🤒', color: '#EF4444', backgroundColor: '#FEF2F2', borderColor: '#FECACA', presenceType: 'OFF', defaultBalanceDays: 10, displayOrder: 2, active: true, halfDayAllowed: true },
  { id: 5, publicId: 'lt-unpaid', name: 'Unpaid Leave', icon: '💼', color: '#5A7A80', backgroundColor: '#ECF4E8', borderColor: '#B8DCC4', presenceType: 'OFF', defaultBalanceDays: null, displayOrder: 5, active: true, halfDayAllowed: false },
]

const mockMembers: TeamMemberSummaryResponse[] = [
  mockTeamMemberSummary({
    id: 3,
    fullName: 'Alex Johnson',
    email: 'alex@company.com',
    department: 'Engineering',
    role: 'MANAGER',
    workforceGroupId: 1,
    workforceGroupName: 'US',
  }),
  mockTeamMemberSummary({
    id: 5,
    fullName: 'Jordan Lee',
    email: 'jordan@company.com',
    department: 'People',
    role: 'ORGANIZATION_ADMIN',
    workforceGroupId: 1,
    workforceGroupName: 'US',
  }),
]

function renderModal(
  editMemberId: number | null = null,
  onClose = vi.fn(),
  onSuccess = vi.fn(),
  onWarning = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
          <TeamMemberModal
            editMemberId={editMemberId}
            onClose={onClose}
            onSuccess={onSuccess}
            onWarning={onWarning}
          />
        </AuthTestProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, onClose }
}

describe('TeamMemberModal — add mode', () => {
  beforeEach(() => {
    vi.mocked(redirectToExternalUrl).mockReset()
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(mockGroups)
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (i18n.language !== 'en') {
      await act(() => i18n.changeLanguage('en'))
    }
  })

  it('renders Add Team Member title', () => {
    renderModal()
    expect(screen.getByText('Add Team Member')).toBeInTheDocument()
  })

  it('[P0] keeps the team-member form open and preserves input on backdrop click', async () => {
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

  it('[P1] still closes from Cancel and Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Add Team Member' })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('submits createTeamMember when form is valid', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    // createTeamMember returns TeamMemberInvitationResponse (the invitation just sent), not a
    // TeamMemberDetailResponse -- the assertion below only checks what was sent, not this shape.
    const createSpy = vi.spyOn(apiClient, 'createTeamMember').mockResolvedValue({
      id: 'invite-99',
      fullName: 'Test Person',
      email: 'tp@company.com',
      role: 'EMPLOYEE',
      status: 'PENDING',
      activeSeat: false,
    })

    renderModal(null, vi.fn(), onSuccess)

    await user.type(screen.getByLabelText(/Full name/i), 'Test Person')
    await user.type(screen.getByLabelText(/Email/i), 'tp@company.com')
    await user.type(screen.getByLabelText(/Department/i), 'IT')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Test Person',
          email: 'tp@company.com',
          department: 'IT',
          role: 'EMPLOYEE',
          workforceGroupId: 1,
          approvalApproverIds: [5],
        }),
      )
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('[P0] blocks approval-level gaps and localizes reviewer roles', async () => {
    const user = userEvent.setup()
    const createSpy = vi.spyOn(apiClient, 'createTeamMember')
    renderModal()

    await waitFor(() => {
      const optionLabels = screen.getAllByRole('option').map((option) => option.textContent)
      expect(optionLabels).toContain('Alex Johnson — Manager')
      expect(optionLabels).toContain('Jordan Lee — Organization Admin')
    })

    await user.type(screen.getByLabelText(/Full name/i), 'Gap Test')
    await user.type(screen.getByLabelText(/Email/i), 'gap@example.com')
    await user.type(screen.getByLabelText(/Department/i), 'Product')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.selectOptions(screen.getByLabelText(/Approval Level 1/), '3')
    await user.selectOptions(screen.getByLabelText(/Approval Level 3/), '5')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /use additional levels in order without gaps/i,
    )
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('[P1] localizes approval reviewer roles in Arabic', async () => {
    await act(() => i18n.changeLanguage('ar'))

    renderModal()

    await waitFor(() => {
      const optionLabels = screen.getAllByRole('option').map((option) => option.textContent)
      expect(optionLabels).toContain('Alex Johnson — مدير')
      expect(optionLabels).toContain('Jordan Lee — مسؤول المؤسسة')
    })
  })

  it('renders an upgrade prompt with CTA for plan-limit marker', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onWarning = vi.fn()
    const detail = 'Nile Harbor is at the 5-user Free limit'
    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(
      new ApiError(409, {
        type: 'https://leaveo.net/errors/conflict',
        title: 'Conflict',
        status: 409,
        detail,
        instance: '/api/v1/team-members',
        code: 'plan-limit-reached',
      }),
    )

    renderModal(null, vi.fn(), onSuccess, onWarning)

    await user.type(screen.getByLabelText(/Full name/i), 'Sixth User')
    await user.type(screen.getByLabelText(/Email/i), 'sixth@company.com')
    await user.type(screen.getByLabelText(/Department/i), 'Ops')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(detail)
    expect(screen.getByRole('button', { name: 'Upgrade to Growth' })).toBeInTheDocument()
    expect(screen.getByText(/Contact Platform Admin to upgrade/i)).toBeInTheDocument()
    expect(onWarning).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('keeps duplicate-email conflicts on the warning toast path without upgrade CTA', async () => {
    const user = userEvent.setup()
    const onWarning = vi.fn()
    const detail = 'Email already in use within this organization'
    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(
      new ApiError(409, {
        type: 'https://leaveo.net/errors/conflict',
        title: 'Conflict',
        status: 409,
        detail,
        instance: '/api/v1/team-members',
      }),
    )

    renderModal(null, vi.fn(), vi.fn(), onWarning)

    await user.type(screen.getByLabelText(/Full name/i), 'Jordan Lee')
    await user.type(screen.getByLabelText(/Email/i), 'jordan@company.com')
    await user.type(screen.getByLabelText(/Department/i), 'Ops')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(onWarning).toHaveBeenCalledWith(detail)
    })
    expect(screen.queryByRole('button', { name: 'Upgrade to Growth' })).not.toBeInTheDocument()
  })

  it('calls checkout and redirects when upgrade CTA succeeds', async () => {
    const user = userEvent.setup()
    const detail = 'Nile Harbor is at the 5-user Free limit'
    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(
      new ApiError(409, {
        type: 'https://leaveo.net/errors/conflict',
        title: 'Conflict',
        status: 409,
        detail,
        instance: '/api/v1/team-members',
        code: 'plan-limit-reached',
      }),
    )
    const checkoutSpy = vi.spyOn(apiClient, 'createCheckoutSession').mockResolvedValue({
      checkoutUrl: 'https://checkout.stripe.test/session',
    })

    renderModal()

    await user.type(screen.getByLabelText(/Full name/i), 'Sixth User')
    await user.type(screen.getByLabelText(/Email/i), 'sixth@company.com')
    await user.type(screen.getByLabelText(/Department/i), 'Ops')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))
    await user.click(await screen.findByRole('button', { name: 'Upgrade to Growth' }))

    await waitFor(() => {
      expect(checkoutSpy).toHaveBeenCalledWith({ plan: 'GROWTH' })
      expect(redirectToExternalUrl).toHaveBeenCalledWith('https://checkout.stripe.test/session')
    })
  })

  it('shows manual fallback when checkout is rejected', async () => {
    const user = userEvent.setup()
    const detail = 'Nile Harbor is at the 5-user Free limit'
    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(
      new ApiError(409, {
        type: 'https://leaveo.net/errors/conflict',
        title: 'Conflict',
        status: 409,
        detail,
        instance: '/api/v1/team-members',
        code: 'plan-limit-reached',
      }),
    )
    vi.spyOn(apiClient, 'createCheckoutSession').mockRejectedValue(
      new ApiError(400, {
        type: 'https://leaveo.net/errors/validation-failed',
        title: 'Validation failed',
        status: 400,
        detail: 'Plan is not upgradeable',
        instance: '/api/v1/billing/checkout-session',
      }),
    )

    renderModal()

    await user.type(screen.getByLabelText(/Full name/i), 'Sixth User')
    await user.type(screen.getByLabelText(/Email/i), 'sixth@company.com')
    await user.type(screen.getByLabelText(/Department/i), 'Ops')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))
    await user.click(await screen.findByRole('button', { name: 'Upgrade to Growth' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Self-serve checkout is unavailable/i,
      )
    })
    expect(screen.getByText(/Contact Platform Admin to upgrade/i)).toBeInTheDocument()
  })

  it('keeps modal open after plan-limit create error', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(
      new ApiError(409, {
        type: 'https://leaveo.net/errors/conflict',
        title: 'Conflict',
        status: 409,
        detail: 'Nile Harbor is at the 5-user Free limit',
        instance: '/api/v1/team-members',
        code: 'plan-limit-reached',
      }),
    )

    renderModal(null, onClose)

    await user.type(screen.getByLabelText(/Full name/i), 'Sixth User')
    await user.type(screen.getByLabelText(/Email/i), 'sixth@company.com')
    await user.type(screen.getByLabelText(/Department/i), 'Ops')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(screen.getByText('Add Team Member')).toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('blocks Save when Workforce Group is not selected', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    renderModal(null, vi.fn(), onSuccess)

    // Fill required fields but leave group empty
    await user.type(screen.getByLabelText(/Full name/i), 'Test Person')
    await user.type(screen.getByLabelText(/Email/i), 'tp@company.com')
    await user.type(screen.getByLabelText(/Department/i), 'IT')

    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Workforce Group is required')
    })
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('shows entitlement inputs only for capped leave types', async () => {
    renderModal()

    await waitFor(() => {
      // Annual Leave (capped) and Sick Leave (capped) have entitlement rows
      expect(screen.getByTestId('ent-row-1')).toBeInTheDocument()
      expect(screen.getByTestId('ent-row-2')).toBeInTheDocument()
      // Unpaid Leave (uncapped) does NOT have an entitlement row
      expect(screen.queryByTestId('ent-row-5')).not.toBeInTheDocument()
    })
  })

  it('hides Reports-to field for non-Employee roles', async () => {
    const user = userEvent.setup()
    renderModal()

    // Default role is EMPLOYEE — manager field should be visible
    await waitFor(() => {
      expect(screen.getByTestId('manager-field')).toBeInTheDocument()
    })

    // Change to MANAGER — field should disappear
    await user.selectOptions(screen.getByLabelText(/Role/i), 'MANAGER')

    expect(screen.queryByTestId('manager-field')).not.toBeInTheDocument()
  })

  it('shows Reports-to field for Employee role', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByTestId('manager-field')).toBeInTheDocument()
    })
  })
})

describe('TeamMemberModal — edit mode', () => {
  const mockDetail: TeamMemberDetailResponse = mockTeamMemberDetail({
    id: 7,
    fullName: 'Priya Nair',
    email: 'priya@company.com',
    department: 'Engineering',
    role: 'EMPLOYEE',
    workforceGroupId: 1,
    workforceGroupName: 'US',
    managerId: 3,
    managerName: 'Alex Johnson',
    entitlements: [
      { leaveTypeId: 1, leaveTypeName: 'Annual Leave', allocatedDays: 20 },
      { leaveTypeId: 2, leaveTypeName: 'Sick Leave', allocatedDays: 10 },
    ],
  })

  beforeEach(() => {
    vi.mocked(redirectToExternalUrl).mockReset()
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(mockGroups)
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
    vi.spyOn(apiClient, 'getTeamMember').mockResolvedValue(mockDetail)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders Edit Team Member title', async () => {
    renderModal(7)

    await waitFor(() => {
      expect(screen.getByText('Edit Team Member')).toBeInTheDocument()
    })
  })

  it('pre-fills form fields from existing member data', async () => {
    renderModal(7)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Priya Nair')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Engineering')).toBeInTheDocument()
    })
  })

  it('submits updateTeamMember when edit form is saved', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const updateSpy = vi.spyOn(apiClient, 'updateTeamMember').mockResolvedValue(mockDetail)

    renderModal(7, vi.fn(), onSuccess)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Priya Nair')).toBeInTheDocument()
    })

    await user.clear(screen.getByLabelText(/Department/i))
    await user.type(screen.getByLabelText(/Department/i), 'Product')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          fullName: 'Priya Nair',
          department: 'Product',
          role: 'EMPLOYEE',
          workforceGroupId: 1,
          approvalApproverIds: undefined,
        }),
      )
      expect(onSuccess).toHaveBeenCalledWith('Team member updated.')
    })
  })

  it('does not show email field in edit mode', async () => {
    renderModal(7)

    await waitFor(() => {
      expect(screen.queryByLabelText(/Email/i)).not.toBeInTheDocument()
    })
  })
})

// A tenant now starts with zero Workforce Groups — the Organization Admin creates them — so the required
// group field can legitimately have nothing to pick. The modal has to say so and refuse to
// submit, otherwise the only feedback is a 400 from the server.
describe('TeamMemberModal — organization has no workforce groups', () => {
  function LocationProbe() {
    const location = useLocation()
    return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  }

  function renderWithLocation(onClose = vi.fn()) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings?category=people']}>
          <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
            <TeamMemberModal
              editMemberId={null}
              onClose={onClose}
              onSuccess={vi.fn()}
              onWarning={vi.fn()}
            />
            <LocationProbe />
          </AuthTestProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { onClose }
  }

  beforeEach(() => {
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([])
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[P1] explains the empty group field and blocks save until a group exists', async () => {
    renderWithLocation()

    const hint = await screen.findByTestId('tm-no-groups-hint')
    expect(hint).toHaveTextContent(/Every team member belongs to a workforce group/i)
    expect(screen.getByLabelText(/Workforce Group/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('[P1] routes to Working Calendars so the admin can create the first group', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWithLocation()

    await user.click(await screen.findByTestId('tm-create-group-link'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/settings?category=working-calendars',
    )
  })

  it('[P1] leaves the field alone once the organization has groups', async () => {
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(mockGroups)
    renderWithLocation()

    await waitFor(() => expect(screen.getByLabelText(/Workforce Group/i)).toBeEnabled())
    expect(screen.queryByTestId('tm-no-groups-hint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
