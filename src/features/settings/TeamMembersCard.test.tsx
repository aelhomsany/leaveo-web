import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockTeamMemberSummary } from '../../test/apiFixtures'
import { TeamMembersCard } from './TeamMembersCard'
import type {
  TeamMemberSummaryResponse,
  WorkforceGroupResponse,
} from '../../api/generated/types'
import { MemoryRouter } from 'react-router-dom'

function renderCard(
  onSuccess = vi.fn(),
  onWarning = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
          <TeamMembersCard onSuccess={onSuccess} onWarning={onWarning} />
        </AuthTestProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * Deactivate and reactivate sit behind the row's overflow menu, so a test that wants
 * one has to open the menu the way a user would. Only one menu is open at a time.
 */
function openMemberMenu(memberName: string) {
  fireEvent.click(screen.getByRole('button', { name: `More actions: ${memberName}` }))
}

const mockMembers: TeamMemberSummaryResponse[] = [
  mockTeamMemberSummary({
    id: 1,
    fullName: 'Jordan Lee',
    email: 'jordan@company.com',
    department: 'People Ops',
    role: 'ORGANIZATION_ADMIN',
    workforceGroupId: 1,
    workforceGroupName: 'US',
  }),
  mockTeamMemberSummary({
    id: 2,
    fullName: 'Sarah Chen',
    email: 'sarah@company.com',
    department: 'Engineering',
    role: 'EMPLOYEE',
    workforceGroupId: 2,
    workforceGroupName: 'Egypt',
    managerId: 3,
    managerName: 'Alex Johnson',
  }),
]

describe('TeamMembersCard', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[P1] announces team members loading via role=status', () => {
    vi.spyOn(apiClient, 'getTeamMembers').mockImplementation(
      () => new Promise(() => undefined),
    )

    renderCard()

    expect(screen.getByRole('status', { name: /loading/i })).toHaveAttribute('aria-busy', 'true')
  })

  it('renders member rows after loading', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByTestId('team-members-list')).toBeInTheDocument()
      expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
      expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    })

    // Group pills use hash-derived CSS custom properties. Scoped to the table because
    // the supporting rail breaks the roster down by group, so every group name is on
    // screen twice by design and an unscoped getByText no longer resolves.
    const list = within(screen.getByTestId('team-members-list'))
    const usPill = list.getByText('US')
    const egyptPill = list.getByText('Egypt')
    expect(usPill).toHaveClass('group-pill')
    expect(egyptPill).toHaveClass('group-pill')
    expect(usPill).not.toHaveClass('group-pill-us')
    expect(egyptPill).not.toHaveClass('group-pill-egypt')
    expect((usPill as HTMLElement).style.getPropertyValue('--pill-bg')).toBeTruthy()
    expect((egyptPill as HTMLElement).style.getPropertyValue('--pill-bg')).toBeTruthy()
    expect((usPill as HTMLElement).style.getPropertyValue('--pill-bg')).not.toBe(
      (egyptPill as HTMLElement).style.getPropertyValue('--pill-bg'),
    )
    // The manager is a column now, not a middot-joined fragment of a meta line, so
    // it is asserted where a reader would look for it: Sarah's cell under the header.
    expect(screen.getByRole('columnheader', { name: 'Reports to' })).toBeInTheDocument()
    const sarahRow = screen.getByTestId('team-member-row-2')
    expect(within(sarahRow).getByText('Alex Johnson')).toBeInTheDocument()
  })

  // Names, team names and emails are entered by users and are never translated with
  // the UI. Without `dir="auto"` they inherit the page direction, so Latin data in
  // the Arabic UI renders with its trailing punctuation at the wrong end — a name
  // like "Alex J." becomes ".Alex J". See also the ApprovalCard guard.
  it('[P0] renders user-entered member data with its own direction', async () => {
    renderCard()

    await waitFor(() => expect(screen.getByText('Sarah Chen')).toBeInTheDocument())

    // Either mechanism is acceptable: <bdi> is dir="auto" plus isolation.
    const keepsOwnDirection = (element: HTMLElement) =>
      element.tagName === 'BDI' || element.getAttribute('dir') === 'auto'

    // Scoped to the table: the rail restates group names, so 'Egypt' matches twice.
    const list = within(screen.getByTestId('team-members-list'))
    expect(keepsOwnDirection(list.getByText('Sarah Chen'))).toBe(true)
    expect(keepsOwnDirection(list.getByText('Egypt'))).toBe(true)
    expect(keepsOwnDirection(list.getByText('sarah@company.com'))).toBe(true)
  })

  it('[P1] filters the scalable people list by name, email, role, or group', async () => {
    renderCard()

    const search = await screen.findByTestId('team-members-search')
    fireEvent.change(search, { target: { value: 'Egypt' } })

    expect(screen.queryByText('Jordan Lee')).not.toBeInTheDocument()
    expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 2 people')

    fireEvent.change(search, { target: { value: 'no match' } })
    expect(screen.getByText('No team members match this search.')).toBeInTheDocument()
  })

  it('[P1] matches the humanized role label, not just the raw enum value', async () => {
    renderCard()

    const search = await screen.findByTestId('team-members-search')
    // Jordan Lee's role is the raw enum ORGANIZATION_ADMIN, displayed as "Organization Admin" —
    // search must match what's shown, not just the underscored enum.
    fireEvent.change(search, { target: { value: 'Organization Admin' } })

    expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
    expect(screen.queryByText('Sarah Chen')).not.toBeInTheDocument()
  })

  it('[P1] matches by email address', async () => {
    renderCard()

    const search = await screen.findByTestId('team-members-search')
    fireEvent.change(search, { target: { value: 'sarah@company.com' } })

    expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    expect(screen.queryByText('Jordan Lee')).not.toBeInTheDocument()
  })

  it('[P1] clears a stale search filter after successfully adding a member', async () => {
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
    ]
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(mockGroups)
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue([])
    // createTeamMember returns TeamMemberInvitationResponse (the invitation just sent), not a
    // TeamMemberDetailResponse -- this test only checks that the search filter clears afterward.
    vi.spyOn(apiClient, 'createTeamMember').mockResolvedValue({
      id: 'invite-9',
      fullName: 'New Hire',
      email: 'new.hire@company.com',
      role: 'EMPLOYEE',
      status: 'PENDING',
      activeSeat: false,
    })
    const user = userEvent.setup()
    renderCard()

    const search = await screen.findByTestId('team-members-search')
    fireEvent.change(search, { target: { value: 'no match' } })
    expect(screen.getByText('No team members match this search.')).toBeInTheDocument()

    await user.click(screen.getByTestId('add-member-btn'))
    // Scoped to the dialog: the rail's "By workforce group" note is a section named by
    // its own heading, so its accessible name matches /Workforce Group/i as well.
    const form = within(screen.getByRole('dialog'))
    await user.type(form.getByLabelText(/Full name/i), 'New Hire')
    await user.type(form.getByLabelText(/Email/i), 'new.hire@company.com')
    await user.type(form.getByLabelText(/Department/i), 'Ops')
    await user.selectOptions(form.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(screen.getByTestId('team-members-search')).toHaveValue('')
    })
    expect(screen.queryByText('No team members match this search.')).not.toBeInTheDocument()
  })

  it('renders Add Member CTA button', async () => {
    renderCard()

    expect(screen.getByTestId('add-member-btn')).toBeInTheDocument()
    expect(screen.getByTestId('add-member-btn')).toHaveTextContent('Add Member')
  })

  it('renders Edit button for each member', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByTestId('edit-member-1')).toBeInTheDocument()
      expect(screen.getByTestId('edit-member-2')).toBeInTheDocument()
    })
  })

  it('shows empty state when no members', async () => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue([])

    renderCard()

    await waitFor(() => {
      expect(screen.getByText('No team members yet.')).toBeInTheDocument()
    })
  })

  it('[P0][Story 8.5] renders active and deactivated status labels while keeping both rows visible', async () => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue([
      { ...mockMembers[0], status: 'ACTIVE' },
      { ...mockMembers[1], status: 'DEACTIVATED', deactivatedAt: '2026-07-04T10:00:00Z' },
    ] as TeamMemberSummaryResponse[])

    renderCard()

    await waitFor(() => {
      const list = within(screen.getByTestId('team-members-list'))
      expect(list.getByText('Jordan Lee')).toBeInTheDocument()
      expect(list.getByText('Sarah Chen')).toBeInTheDocument()
      expect(list.getByText('Active')).toBeInTheDocument()
      // Scoped: the rail counts deactivated people, so the word is on screen twice.
      expect(list.getByText('Deactivated')).toBeInTheDocument()
    })

    openMemberMenu('Jordan Lee')
    expect(screen.getByTestId('deactivate-member-1')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })

    openMemberMenu('Sarah Chen')
    expect(screen.getByTestId('reactivate-member-2')).toBeInTheDocument()
  })

  it('[P0][Story 8.5] calls lifecycle API only after deactivation confirmation', async () => {
    const deactivateTeamMember = vi
      .spyOn(apiClient as typeof apiClient & {
        deactivateTeamMember: (id: number) => Promise<TeamMemberSummaryResponse>
      }, 'deactivateTeamMember')
      .mockResolvedValue({ ...mockMembers[1], status: 'DEACTIVATED' } as TeamMemberSummaryResponse)

    renderCard()

    await waitFor(() => {
      expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    })

    openMemberMenu('Sarah Chen')
    fireEvent.click(screen.getByTestId('deactivate-member-2'))

    expect(deactivateTeamMember).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Deactivate Team Member' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Deactivation' }))

    await waitFor(() => {
      expect(deactivateTeamMember).toHaveBeenCalledWith(2)
    })
  })

  it('[P1][Story 8.5] routes lifecycle success through Settings toast callback', async () => {
    const onSuccess = vi.fn()
    vi.spyOn(apiClient as typeof apiClient & {
      deactivateTeamMember: (id: number) => Promise<TeamMemberSummaryResponse>
    }, 'deactivateTeamMember')
      .mockResolvedValue({ ...mockMembers[1], status: 'DEACTIVATED' } as TeamMemberSummaryResponse)

    renderCard(onSuccess)

    await waitFor(() => {
      expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    })

    openMemberMenu('Sarah Chen')
    fireEvent.click(screen.getByTestId('deactivate-member-2'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Deactivation' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('Sarah Chen deactivated')
    })
  })
})

/**
 * Story 10.10 — UXA-07 contextual accessible names for repeated row actions.
 */
describe('TeamMembersCard accessibility ATDD — Story 10.10', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('[P0] exposes member-qualified Edit and Deactivate accessible names', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit.*jordan lee/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edit.*sarah chen/i })).toBeInTheDocument()
    })

    // Deactivate moved behind the overflow menu; the trigger and the item both have
    // to name the member, or a screen-reader list of them is five identical rows.
    expect(screen.getByRole('button', { name: 'More actions: Jordan Lee' })).toBeInTheDocument()
    openMemberMenu('Sarah Chen')
    expect(screen.getByRole('menuitem', { name: /deactivate.*sarah chen/i })).toBeInTheDocument()
  })

  test('[P0] exposes member-qualified Reactivate accessible name for deactivated rows', async () => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue([
      { ...mockMembers[1], status: 'DEACTIVATED', deactivatedAt: '2026-07-04T10:00:00Z' },
    ] as TeamMemberSummaryResponse[])

    renderCard()

    await waitFor(() => {
      expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    })

    openMemberMenu('Sarah Chen')
    expect(screen.getByRole('menuitem', { name: /reactivate.*sarah chen/i })).toBeInTheDocument()
  })

  // The band above the roster summarises the organization, not the current search. Every figure
  // is one a reader would otherwise get by counting rows in a table that paginates.
  describe('supporting band', () => {
    const roster: TeamMemberSummaryResponse[] = [
      { ...mockMembers[0], id: 1, fullName: 'Jordan Lee', role: 'ORGANIZATION_ADMIN', workforceGroupName: 'US', managerName: undefined },
      { ...mockMembers[1], id: 2, fullName: 'Sarah Chen', role: 'EMPLOYEE', workforceGroupName: 'Egypt', managerName: 'Alex Johnson' },
      { ...mockMembers[1], id: 3, fullName: 'Priya Nair', email: 'priya@company.com', role: 'EMPLOYEE', workforceGroupName: 'Egypt', managerName: 'Alex Johnson' },
      { ...mockMembers[1], id: 4, fullName: 'Tom Reed', email: 'tom@company.com', role: 'MANAGER', workforceGroupName: 'US', managerName: 'Jordan Lee' },
      { ...mockMembers[1], id: 5, fullName: 'Gone Away', email: 'gone@company.com', role: 'EMPLOYEE', workforceGroupName: 'US', managerName: 'Alex Johnson', status: 'DEACTIVATED' },
    ] as TeamMemberSummaryResponse[]

    it('counts roles and deactivations off the whole roster', async () => {
      vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(roster)
      renderCard()

      // The list container is rendered while the request is still in flight, so wait for a row.
      await screen.findByTestId('team-member-row-1')

      // Deactivated people are counted once, as deactivated — never again inside a role.
      expect(screen.getByTestId('members-role-ORGANIZATION_ADMIN')).toHaveTextContent('1')
      expect(screen.getByTestId('members-role-MANAGER')).toHaveTextContent('1')
      expect(screen.getByTestId('members-role-EMPLOYEE')).toHaveTextContent('2')
      expect(screen.getByTestId('members-deactivated')).toHaveTextContent('1')
    })

    it('names the heaviest approver and flags a chain that rests on one person', async () => {
      vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(roster)
      renderCard()

      // The list container is rendered while the request is still in flight, so wait for a row.
      await screen.findByTestId('team-member-row-1')

      // Alex Johnson holds two of the four active people; Jordan Lee holds one.
      expect(screen.getByTestId('members-top-approver')).toHaveTextContent('Alex Johnson')
      expect(screen.getByTestId('members-top-approver')).toHaveTextContent('2')
      // Two of four is not more than half, so nothing is flagged yet.
      expect(screen.queryByTestId('members-approval-concentrated')).not.toBeInTheDocument()
    })

    it('flags concentration once one approver holds more than half the active roster', async () => {
      vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue([
        roster[0],
        { ...roster[1], managerName: 'Alex Johnson' },
        { ...roster[2], managerName: 'Alex Johnson' },
        { ...roster[3], managerName: 'Alex Johnson' },
      ] as TeamMemberSummaryResponse[])
      renderCard()

      // The list container is rendered while the request is still in flight, so wait for a row.
      await screen.findByTestId('team-member-row-1')

      expect(screen.getByTestId('members-approval-concentrated')).toBeInTheDocument()
    })

    it('summarises the roster, not the current search', async () => {
      vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(roster)
      renderCard()

      await screen.findByTestId('team-member-row-1')
      fireEvent.change(screen.getByTestId('team-members-search'), { target: { value: 'Priya' } })

      // The table narrows to one row; the band still describes the organization behind it.
      expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 5 people')
      expect(screen.getByTestId('members-role-EMPLOYEE')).toHaveTextContent('2')
      expect(screen.getByTestId('members-deactivated')).toHaveTextContent('1')
    })
  })
})
