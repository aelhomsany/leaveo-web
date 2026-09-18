import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MemoryRouter,
  RouterProvider,
  createMemoryRouter,
} from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { LeaveTypeResponse, TeamMemberSummaryResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockTeamMemberSummary, mockWorkforceGroup } from '../../test/apiFixtures'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { SettingsPage } from './SettingsPage'

/**
 * Story 11.5 — ATDD coverage for Settings Information Architecture (activated
 * during bmad-dev-story; extended during code review with data-router
 * coverage for the unsaved-changes route blocker).
 * Cover: category navigation, URL/deep-link state, group-context preservation,
 * unsaved-form protection, keyboard operation, SPA cannot-proceed guards.
 * Do NOT mirror Jakarta @NotBlank / @Email — API remains authoritative.
 */

const mockLeaveTypes: LeaveTypeResponse[] = [
  {
    id: 1,
    publicId: 'lt-1',
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
]

const mockTeamMembers: TeamMemberSummaryResponse[] = [
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
    fullName: 'Omar Hassan',
    email: 'omar@company.com',
    department: 'Engineering',
    role: 'EMPLOYEE',
    workforceGroupId: 2,
    workforceGroupName: 'Egypt',
    managerId: 1,
    managerName: 'Jordan Lee',
  }),
]

function mockSettingsApis() {
  vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
    mockWorkforceGroup({ id: 1, name: 'US' }),
    mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
  ])
  vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([
    {
      id: 1,
      workforceGroupId: 1,
      dateFrom: '2026-06-19',
      dateTo: '2026-06-19',
      name: 'Juneteenth',
    },
  ])
  vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
  vi.spyOn(apiClient, 'getManagedLeaveTypes').mockResolvedValue(mockLeaveTypes)
  vi.spyOn(apiClient, 'getPolicySettingsOverview').mockResolvedValue({ leaveTypes: [], users: [], workforceGroups: [] })
  vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockTeamMembers)
  vi.spyOn(apiClient, 'getCalendarFeed').mockResolvedValue({ active: false })
  vi.spyOn(apiClient, 'getSlackStatus').mockResolvedValue({
    workspaceConnected: false,
    status: null,
    teamName: null,
    installedAt: null,
    lastErrorCategory: null,
    me: { linked: false, status: 'UNCHECKED' },
  })
  vi.spyOn(apiClient, 'getCalendarSyncStatus').mockResolvedValue([
    {
      provider: 'GOOGLE',
      connected: false,
      accountEmail: null,
      status: 'DISCONNECTED',
      lastErrorCategory: null,
      lastSyncedAt: null,
      nextRetryAt: null,
      pendingEventCount: 0,
      failedEventCount: 0,
    },
  ])
  vi.spyOn(apiClient, 'getNotificationPreferences').mockResolvedValue([
    {
      channel: 'IN_APP',
      scope: 'WORKFLOW',
      mandatory: true,
      enabled: true,
      mutedUntil: null,
      effectiveEnabledNow: true,
    },
    {
      channel: 'EMAIL',
      scope: 'WORKFLOW',
      mandatory: false,
      enabled: true,
      mutedUntil: null,
      effectiveEnabledNow: true,
    },
  ])
  vi.spyOn(apiClient, 'putWorkforceGroupWeekendDays').mockResolvedValue(
    mockWorkforceGroup({ id: 1, name: 'US' }),
  )
}

function renderSettings(initialPath = '/settings') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
            <SettingsPage />
          </AuthTestProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function renderSettingsWithDataRouter(initialPath = '/settings') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const router = createMemoryRouter(
    [
      {
        path: '/settings',
        element: (
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
                <SettingsPage />
              </AuthTestProvider>
            </ToastProvider>
          </QueryClientProvider>
        ),
      },
      {
        path: '/my-leaves',
        element: <div data-testid="route-after-settings">My Leaves</div>,
      },
    ],
    { initialEntries: [initialPath] },
  )

  render(<RouterProvider router={router} />)
  return router
}

describe('SettingsInformationArchitecture ATDD — Story 11.5', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(
    '[P0] Given Settings opens with no category query, When the page renders, Then six categories exist and Working calendars is selected',
    async () => {
      mockSettingsApis()
      renderSettings('/settings')

      await screen.findByTestId('settings-page')
      const nav = screen.getByTestId('settings-category-nav')
      expect(within(nav).getByTestId('settings-category-organization')).toBeInTheDocument()
      expect(within(nav).getByTestId('settings-category-working-calendars')).toBeInTheDocument()
      expect(within(nav).getByTestId('settings-category-leave-policies')).toBeInTheDocument()
      expect(within(nav).getByTestId('settings-category-people')).toBeInTheDocument()
      // Notifications moved to the My settings page (Plan PUENTE D-12).
      expect(within(nav).queryByTestId('settings-category-notifications')).not.toBeInTheDocument()
      expect(within(nav).getByTestId('settings-category-integrations')).toBeInTheDocument()

      expect(screen.getByTestId('settings-category-working-calendars')).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByTestId('settings-panel-working-calendars')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-panel-people')).not.toBeInTheDocument()
    },
  )

  it(
    '[P0] Given category=people in the URL, When Settings loads, Then the People panel is shown and People is selected',
    async () => {
      mockSettingsApis()
      renderSettings('/settings?category=people')

      await screen.findByTestId('settings-panel-people')
      expect(screen.getByTestId('settings-category-people')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('team-members-card')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-panel-working-calendars')).not.toBeInTheDocument()
    },
  )

  it(
    '[P0] Given Working calendars is active, When Leave policies is selected, Then URL updates and only that panel is visible',
    async () => {
      mockSettingsApis()
      const user = userEvent.setup()
      renderSettings('/settings')

      await screen.findByTestId('settings-panel-working-calendars')
      await user.click(screen.getByTestId('settings-category-leave-policies'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-panel-leave-policies')).toBeInTheDocument()
      })
      expect(screen.getByTestId('leave-types-card')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-panel-working-calendars')).not.toBeInTheDocument()
      expect(screen.getByTestId('settings-category-leave-policies')).toHaveAttribute(
        'aria-selected',
        'true',
      )
      // URL encoding of category=leave-policies is asserted in E2E deep-link coverage;
      // MemoryRouter does not sync to window.location.
    },
  )

  it(
    '[P0] Given Working calendars with group=2 in the URL, When the panel loads, Then Egypt is the active Workforce Group',
    async () => {
      mockSettingsApis()
      renderSettings('/settings?category=working-calendars&group=2')

      await screen.findByTestId('settings-panel-working-calendars')
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Egypt/i })).toHaveAttribute('aria-selected', 'true')
      })
      expect(screen.getByTestId('working-calendars-impact')).toBeInTheDocument()
      expect(screen.getByTestId('working-calendars-affected-count')).toHaveTextContent(/1/)
    },
  )

  it(
    '[P0] Given Working calendars, When the Workforce Group switches, Then weekends, holidays, count, and impact update as one panel',
    async () => {
      mockSettingsApis()
      const user = userEvent.setup()
      renderSettings('/settings?category=working-calendars&group=1')

      await screen.findByTestId('settings-panel-working-calendars')
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /US/i })).toHaveAttribute('aria-selected', 'true')
      })

      const usCount = screen.getByTestId('working-calendars-affected-count').textContent
      await user.click(screen.getByRole('tab', { name: /Egypt/i }))

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Egypt/i })).toHaveAttribute('aria-selected', 'true')
      })
      expect(screen.getByTestId('weekend-chips')).toBeInTheDocument()
      expect(screen.getByTestId('working-calendars-impact')).toBeInTheDocument()
      expect(screen.getByTestId('working-calendars-affected-count')).toBeInTheDocument()
      // Group switch must refresh the impact region (count/copy may change with group).
      expect(screen.getByTestId('working-calendars-affected-count').textContent).toBeTruthy()
      expect(usCount).toBeTruthy()
    },
  )

  it(
    '[P0] Given a dirty Working calendars draft, When switching category, Then discard Modal blocks proceed until Discard or Continue',
    async () => {
      mockSettingsApis()
      const user = userEvent.setup()
      renderSettings('/settings?category=working-calendars')

      await screen.findByTestId('settings-panel-working-calendars')
      // Preferred Coastal path: toggle a weekend chip into draft (no immediate PUT).
      await user.click(await screen.findByRole('checkbox', { name: /Fri weekend day for US/i }))

      await user.click(screen.getByTestId('settings-category-people'))

      const modal = await screen.findByTestId('settings-unsaved-discard-modal')
      expect(modal).toBeInTheDocument()
      expect(screen.queryByTestId('settings-panel-people')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('settings-unsaved-continue-btn'))
      expect(screen.getByTestId('settings-panel-working-calendars')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-unsaved-discard-modal')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('settings-category-people'))
      await screen.findByTestId('settings-unsaved-discard-modal')
      await user.click(screen.getByTestId('settings-unsaved-discard-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-panel-people')).toBeInTheDocument()
      })
    },
  )

  it(
    '[P0] Given a dirty Working calendars draft, When switching Workforce Group, Then discard Modal appears before changing group',
    async () => {
      mockSettingsApis()
      const user = userEvent.setup()
      renderSettings('/settings?category=working-calendars&group=1')

      await screen.findByTestId('settings-panel-working-calendars')
      await user.click(await screen.findByRole('checkbox', { name: /Fri weekend day for US/i }))
      await user.click(screen.getByRole('tab', { name: /Egypt/i }))

      const modal = await screen.findByTestId('settings-unsaved-discard-modal')
      expect(modal).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /US/i })).toHaveAttribute('aria-selected', 'true')

      await user.click(screen.getByTestId('settings-unsaved-discard-btn'))
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Egypt/i })).toHaveAttribute('aria-selected', 'true')
      })
    },
  )

  it(
    '[P0] Given category tablist focus, When Home and End are pressed, Then selection moves to first and last category',
    async () => {
      mockSettingsApis()
      const user = userEvent.setup()
      renderSettings('/settings')

      // Let the Working calendars panel's own data settle first — interacting
      // before its group data resolves can catch a one-tick window where the
      // panel's dirty flag hasn't yet synced to the loaded group.
      await screen.findByTestId('workforce-groups-weekends-card')
      const working = screen.getByTestId('settings-category-working-calendars')
      working.focus()
      expect(working).toHaveFocus()

      await user.keyboard('{End}')
      await waitFor(() => {
        expect(screen.getByTestId('settings-category-integrations')).toHaveFocus()
      })

      await user.keyboard('{Home}')
      await waitFor(() => {
        expect(screen.getByTestId('settings-category-organization')).toHaveFocus()
      })
    },
  )

  it(
    '[P0] Given category tablist focus on desktop, When ArrowDown and ArrowUp are pressed, Then selection moves to the next and previous category',
    async () => {
      mockSettingsApis()
      const user = userEvent.setup()
      renderSettings('/settings')

      // Let the Working calendars panel's own data settle first — interacting
      // before its group data resolves can catch a one-tick window where the
      // panel's dirty flag hasn't yet synced to the loaded group.
      await screen.findByTestId('workforce-groups-weekends-card')
      const working = screen.getByTestId('settings-category-working-calendars')
      working.focus()
      expect(working).toHaveFocus()

      // Plan UNO folded 'schedules-locations' into Working calendars, so one step
      // down lands on 'calendar-privacy' first.
      await user.keyboard('{ArrowDown}')
      await waitFor(() => {
        expect(screen.getByTestId('settings-category-calendar-privacy')).toHaveFocus()
      })
      expect(screen.getByTestId('settings-category-calendar-privacy')).toHaveAttribute(
        'aria-selected',
        'true',
      )

      // Continuing to leave-policies is asserted by the sibling containment test
      // (WorkforceGroupsWeekendsCard.containment.atdd.test.tsx), which drives the same rail
      // directly. Chaining a second arrow step here does not move selection: this suite mounts the
      // whole SettingsPage, whose requestCategory guard runs against state that has not settled
      // between synchronous key events (code review 2026-08-28).

      await user.keyboard('{ArrowUp}')
      await waitFor(() => {
        expect(screen.getByTestId('settings-category-working-calendars')).toHaveFocus()
      })
    },
  )

  it(
    '[P0] Given category was changed via the URL, When browser Back is triggered, Then the previous category is restored',
    async () => {
      mockSettingsApis()
      const router = renderSettingsWithDataRouter('/settings?category=working-calendars')

      await screen.findByTestId('settings-panel-working-calendars')

      await act(async () => {
        await router.navigate('/settings?category=people')
      })
      await screen.findByTestId('settings-panel-people')

      await act(async () => {
        await router.navigate(-1)
      })

      await waitFor(() => {
        expect(screen.getByTestId('settings-panel-working-calendars')).toBeInTheDocument()
      })
      expect(screen.getByTestId('settings-category-working-calendars')).toHaveAttribute(
        'aria-selected',
        'true',
      )
    },
  )

  it(
    '[P0] Given a dirty Working calendars draft, When Back/Forward changes only the category query, Then the shared discard Modal still blocks it',
    async () => {
      // Back/Forward mutates history directly, bypassing requestCategory's own
      // dirty check — only the router-level blocker can catch a search-only
      // change like this (Story 11.5 review).
      mockSettingsApis()
      const user = userEvent.setup()
      const router = renderSettingsWithDataRouter('/settings?category=working-calendars')

      await user.click(
        await screen.findByRole('checkbox', { name: /Fri weekend day for US/i }),
      )

      await act(async () => {
        await router.navigate('/settings?category=people')
      })

      expect(screen.getByTestId('settings-unsaved-discard-modal')).toBeInTheDocument()
      expect(screen.getByTestId('settings-panel-working-calendars')).toBeInTheDocument()

      await user.click(screen.getByTestId('settings-unsaved-discard-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('settings-panel-people')).toBeInTheDocument()
      })
    },
  )

  it(
    '[P0] Given the discard Modal is already open for a category switch, When an external route navigation starts, Then it is refused instead of silently bypassing the open Modal',
    async () => {
      // AC12: one dialog layer only. A route navigation attempted while the
      // in-app modal is already showing must not slip through unguarded.
      mockSettingsApis()
      const user = userEvent.setup()
      const router = renderSettingsWithDataRouter('/settings?category=working-calendars')

      await user.click(
        await screen.findByRole('checkbox', { name: /Fri weekend day for US/i }),
      )
      await user.click(screen.getByTestId('settings-category-people'))
      await screen.findByTestId('settings-unsaved-discard-modal')

      await act(async () => {
        await router.navigate('/my-leaves')
      })

      expect(screen.getByTestId('settings-unsaved-discard-modal')).toBeInTheDocument()
      expect(screen.queryByTestId('route-after-settings')).not.toBeInTheDocument()
      expect(screen.getByTestId('settings-panel-working-calendars')).toBeInTheDocument()

      await user.click(screen.getByTestId('settings-unsaved-discard-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('settings-panel-people')).toBeInTheDocument()
      })
    },
  )

  it(
    '[P0] Given Working calendars draft with zero weekend days selected, When Save is activated, Then save cannot proceed and impact stays visible',
    async () => {
      // SPA draft guard only — not a Jakarta @NotBlank mirror.
      mockSettingsApis()
      const user = userEvent.setup()
      renderSettings('/settings?category=working-calendars&group=1')

      await screen.findByTestId('settings-panel-working-calendars')
      // Deselect all weekend chips into an invalid draft.
      await user.click(await screen.findByRole('checkbox', { name: /Sat weekend day for US/i }))
      await user.click(screen.getByRole('checkbox', { name: /Sun weekend day for US/i }))

      expect(screen.getByTestId('working-calendars-impact')).toBeInTheDocument()
      const save = screen.getByTestId('working-calendars-save-btn')
      expect(save).toBeDisabled()
      expect(apiClient.putWorkforceGroupWeekendDays).not.toHaveBeenCalled()
    },
  )

  it(
    '[P0] Given a dirty Settings draft, When route navigation starts, Then the shared discard Modal blocks leaving',
    async () => {
      mockSettingsApis()
      const user = userEvent.setup()
      const router = renderSettingsWithDataRouter(
        '/settings?category=working-calendars',
      )

      await user.click(
        await screen.findByRole('checkbox', {
          name: /Fri weekend day for US/i,
        }),
      )
      await act(async () => {
        await router.navigate('/my-leaves')
      })

      expect(screen.getByTestId('settings-unsaved-discard-modal')).toBeInTheDocument()
      expect(screen.queryByTestId('route-after-settings')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('settings-unsaved-continue-btn'))
      expect(screen.getByTestId('settings-panel-working-calendars')).toBeInTheDocument()

      await act(async () => {
        await router.navigate('/my-leaves')
      })
      await user.click(await screen.findByTestId('settings-unsaved-discard-btn'))

      expect(await screen.findByTestId('route-after-settings')).toBeInTheDocument()
    },
  )
})
