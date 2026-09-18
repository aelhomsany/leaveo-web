import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { TeamMemberSummaryResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockTeamMemberSummary } from '../../test/apiFixtures'
import { TeamMembersCard } from './TeamMembersCard'
import { MemoryRouter } from 'react-router-dom'

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

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
          <TeamMembersCard onSuccess={vi.fn()} onWarning={vi.fn()} />
        </AuthTestProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TeamMembersCard design-system ATDD — Story 10.6', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[P0] renders settings role badges with role-badge classes, not global badge-*', async () => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
    const { container } = renderCard()

    await waitFor(() => {
      expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
    })

    const roleBadges = container.querySelectorAll('[class*="role-badge-"]')
    expect(roleBadges.length).toBeGreaterThanOrEqual(2)
    roleBadges.forEach((badge) => {
      expect(badge.className).toMatch(/\brole-badge\b/)
      expect(badge.className).not.toMatch(/^badge\s/)
      expect(badge.className).not.toMatch(/\sbadge-(EMPLOYEE|MANAGER|ORGANIZATION_ADMIN)\b/)
    })
    expect(container.querySelector('.badge-EMPLOYEE, .badge-MANAGER, .badge-ORGANIZATION_ADMIN')).toBeNull()
  })

  it('[P0] deactivation confirm uses btn-danger, not btn-primary', async () => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
    renderCard()

    await waitFor(() => {
      expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    })

    // Deactivate lives in the row's overflow menu.
    fireEvent.click(screen.getByRole('button', { name: 'More actions: Sarah Chen' }))
    fireEvent.click(screen.getByTestId('deactivate-member-2'))

    const confirmButton = screen.getByRole('button', { name: 'Confirm Deactivation' })
    expect(confirmButton).toHaveClass('btn', 'btn-danger')
    expect(confirmButton).not.toHaveClass('btn-primary')
  })

  it('[P1] removes AUD-20 inline fontSize/color/margin styles from list chrome', async () => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue([])
    const { container } = renderCard()

    await waitFor(() => {
      expect(screen.getByText('No team members yet.')).toBeInTheDocument()
    })

    const inlineStyled = container.querySelectorAll('[style*="font-size"], [style*="fontSize"], [style*="margin-right"], [style*="marginRight"]')
    expect(inlineStyled).toHaveLength(0)
    expect(screen.getByText('No team members yet.')).toHaveClass('settings-list-hint')
  })
})
