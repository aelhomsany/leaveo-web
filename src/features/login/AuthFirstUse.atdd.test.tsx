/**
 * Story 11.7 — ATDD RED scaffolds for Auth and First-Use Product Polish.
 * Cover: auth-proof panel, mobile form-first DOM order, invalid-credential recovery
 * (email retained), HR-only first-use cue + Working calendars deep-link, localStorage
 * resume persistence.
 * Do NOT mirror Jakarta @Email / @NotBlank — API Auth*IntegrationTest remains authoritative.
 * Unskip each case during bmad-dev-story when the corresponding AC ships.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import * as apiClient from '../../api/client'
import type {
  BalanceCardResponse,
  RecentRequestResponse,
} from '../../api/generated/types'
import { ToastProvider } from '../../components/ui/ToastProvider'
import {
  AuthTestProvider,
  createMockAuthForRole,
  createMockAuthValue,
  mockUsers,
} from '../../test/authTestUtils'
import { mockRecentApprovalDecision, mockTeamMemberSummary, noCancellation } from '../../test/apiFixtures'
// The Dashboard merged into My Leaves (2026-09-01); the first-use cue and the
// greeting now live on MyLeavesPage, so the "Dashboard" scenarios mount that.
import { MyLeavesPage } from '../my-leaves/MyLeavesPage'
import { LoginPage } from './LoginPage'

const FIRST_USE_STORAGE_PREFIX = 'leaveo.firstUse.v1:'

const mockBalances: BalanceCardResponse[] = [
  {
    leaveTypeId: 1,
    name: 'Annual Leave',
    icon: 'leave',
    color: '#093C5D',
    backgroundColor: '#D6E8ED',
    borderColor: '#0E4F75',
    displayOrder: 1,
    capped: true,
    allocatedDays: 20,
    usedDays: 0,
    remainingDays: 20,
  },
]

const mockRequestHistory: RecentRequestResponse = {
  id: 101,
  leaveTypeId: 1,
  leaveTypeName: 'Annual Leave',
  leaveTypeIcon: 'leave',
  leaveTypeColor: '#093C5D',
  leaveTypeBackgroundColor: '#D6E8ED',
  leaveTypeBorderColor: '#0E4F75',
  dateFrom: '2026-06-01',
  dateTo: '2026-06-02',
  workingDays: 2,
  status: 'APPROVED',
  statusHint: 'Approved',
  declineReason: null,
  approverFirstName: 'Alex',
  cancellation: noCancellation(),
}

function renderLogin(login = vi.fn()) {
  return render(
    <MemoryRouter>
      <AuthTestProvider
        value={createMockAuthValue({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          login,
        })}
      >
        <LoginPage />
      </AuthTestProvider>
    </MemoryRouter>,
  )
}

/**
 * Org maturity is decided by org-scoped signals only (AC7): recent approval
 * decisions, public holidays, and active members with group assignments.
 * `emptyHistory` drives the caller's *personal* dashboard history, which must
 * never affect cue visibility — several tests rely on that independence.
 */
function stubDashboardApis(options?: {
  emptyHistory?: boolean
  noHolidays?: boolean
  noOrgLeaveHistory?: boolean
  unassignedMembers?: boolean
  soleMember?: boolean
}) {
  vi.spyOn(apiClient, 'getDashboardBalances').mockResolvedValue(mockBalances)
  vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue(
    options?.emptyHistory === false ? [mockRequestHistory] : [],
  )
  vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
  vi.spyOn(apiClient, 'getDashboardUpcoming').mockResolvedValue([])
  vi.spyOn(apiClient, 'getPendingApprovalCount').mockResolvedValue({ count: 0 })
  // Plan VUELTA: an Organization Admin's badge sums both queues, so the cancellation
  // count is part of every render that resolves it.
  vi.spyOn(apiClient, 'getPendingCancellationCount').mockResolvedValue({ count: 0 })
  vi.spyOn(apiClient, 'getApprovalCapability').mockResolvedValue({
    canReviewApprovals: false,
  })
  // Guided onboarding declines presentation so the legacy FirstUseCue branch —
  // the subject of these scenarios — renders deterministically.
  vi.spyOn(apiClient, 'getOnboarding').mockResolvedValue({
    presentationEnabled: false,
  } as never)
  vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockResolvedValue(
    options?.noOrgLeaveHistory
      ? []
      : [
          mockRecentApprovalDecision({
            employeeUserId: mockUsers.employee.id,
            employeeFullName: mockUsers.employee.fullName,
          }),
        ],
  )
  vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
    {
      id: 1,
      name: 'US',
      timezone: 'America/New_York',
      weekendDays: ['SATURDAY', 'SUNDAY'],
      currentEffectiveFrom: '2026-01-01',
      scheduledChanges: [],
      overrideCount: 0,
    },
  ])
  vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue(
    options?.noHolidays
      ? []
      : [
          {
            id: 1,
            workforceGroupId: 1,
            dateFrom: '2026-06-19',
            dateTo: '2026-06-19',
            name: 'Juneteenth',
          },
        ],
  )
  vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue([
    mockTeamMemberSummary({
      id: mockUsers.organizationAdmin.id,
      fullName: mockUsers.organizationAdmin.fullName,
      email: mockUsers.organizationAdmin.email,
      department: 'People Ops',
      role: 'ORGANIZATION_ADMIN',
      workforceGroupId: options?.unassignedMembers ? null : 1,
      workforceGroupName: options?.unassignedMembers ? null : 'US',
    }),
    ...(options?.soleMember
      ? []
      : [
          mockTeamMemberSummary({
            id: mockUsers.employee.id,
            fullName: mockUsers.employee.fullName,
            email: mockUsers.employee.email,
            department: 'Engineering',
            role: 'EMPLOYEE',
            workforceGroupId: options?.unassignedMembers ? null : 1,
            workforceGroupName: options?.unassignedMembers ? null : 'US',
          }),
        ]),
  ])
}

function SettingsDeepLinkStub() {
  const [params] = useSearchParams()
  return (
    <div
      data-testid="settings-page"
      data-category={params.get('category') ?? ''}
    >
      Settings
    </div>
  )
}

function renderDashboard(
  role: 'EMPLOYEE' | 'MANAGER' | 'ORGANIZATION_ADMIN' | 'PLATFORM_ADMIN',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/']}>
          <AuthTestProvider value={createMockAuthForRole(role)}>
            <Routes>
              <Route path="/" element={<MyLeavesPage />} />
              <Route path="/settings" element={<SettingsDeepLinkStub />} />
            </Routes>
          </AuthTestProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('AuthFirstUse ATDD — Story 11.7', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it(
    '[P0] Given desktop viewport, When /login renders, Then auth-proof panel and sign-in card are both present',
    async () => {
      renderLogin()

      expect(screen.getByTestId('login-page')).toBeInTheDocument()
      expect(screen.getByTestId('auth-proof-panel')).toBeInTheDocument()
      expect(screen.getByTestId('sign-in-submit')).toBeInTheDocument()
      expect(screen.getByTestId('auth-tenant-reassurance')).toBeInTheDocument()
    },
  )

  it(
    '[P0] Given viewport ≤900px, When /login renders, Then sign-in form precedes auth-proof in DOM without CSS reorder',
    async () => {
      renderLogin()

      const formControl = screen.getByTestId('sign-in-submit')
      const proof = screen.getByTestId('auth-proof-panel')
      const position = formControl.compareDocumentPosition(proof)
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      // jsdom applies no stylesheet, so assert the source contract directly:
      // mobile order must come from DOM order, never from a CSS reorder.
      // Rendered visual order is covered by auth-first-use.spec.ts.
      const css = readFileSync(
        resolve(process.cwd(), 'src/features/login/auth-form.css'),
        'utf8',
      )
      const mobileBlock = css.slice(css.indexOf('@media (max-width: 900px)'))
      expect(mobileBlock).not.toMatch(/[\s;{]order\s*:/)
      expect(mobileBlock).not.toMatch(/row-reverse|column-reverse|wrap-reverse/)
      expect(mobileBlock).toMatch(/flex-direction:\s*column/)
    },
  )

  it(
    '[P0] Given invalid credentials, When sign-in fails, Then alert is shown and email is retained',
    async () => {
      const user = userEvent.setup()
      // Deliberately account-revealing server detail: the UI must map to its
      // own generic copy and never surface this, or sign-in leaks whether an
      // account exists. A test asserting the generic string alone would pass
      // even if the raw detail were rendered.
      const leakingDetail = 'No account found for alex@company.com'
      const login = vi.fn().mockRejectedValue(
        new ApiError(401, { status: 401, detail: leakingDetail }),
      )
      renderLogin(login)

      await user.type(screen.getByTestId('sign-in-email'), 'alex@company.com')
      await user.type(screen.getByTestId('sign-in-password'), 'wrong')
      await user.click(screen.getByTestId('sign-in-submit'))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Invalid email or password')
      expect(alert).not.toHaveTextContent(leakingDetail)
      expect(document.body.textContent).not.toContain('No account found')
      expect(screen.getByTestId('sign-in-email')).toHaveValue('alex@company.com')
    },
  )

  it(
    '[P0] Given ORGANIZATION_ADMIN with incomplete first-use, When Dashboard loads, Then three-step cue shows aria-current and text progress',
    async () => {
      stubDashboardApis({ noHolidays: true })
      localStorage.removeItem(
        `${FIRST_USE_STORAGE_PREFIX}${mockUsers.organizationAdmin.organizationId}:${mockUsers.organizationAdmin.id}`,
      )
      renderDashboard('ORGANIZATION_ADMIN')

      const cue = await screen.findByTestId('first-use-cue')
      expect(cue).toBeInTheDocument()
      expect(within(cue).getByText(/1 of 3/i)).toBeInTheDocument()
      expect(within(cue).getByRole('list')).toBeInTheDocument()
      expect(within(cue).getByTestId('first-use-step-1')).toHaveAttribute(
        'aria-current',
        'step',
      )
      expect(screen.getByTestId('my-leaves-page')).toBeInTheDocument()
    },
  )

  it(
    '[P0] Given first-use cue CTA, When activated, Then navigates to /settings?category=working-calendars',
    async () => {
      const user = userEvent.setup()
      stubDashboardApis({ noHolidays: true })
      renderDashboard('ORGANIZATION_ADMIN')

      const cta = await screen.findByTestId('first-use-cta')
      await user.click(cta)

      const settings = await screen.findByTestId('settings-page')
      expect(settings).toHaveAttribute('data-category', 'working-calendars')
    },
  )

  it(
    '[P0] Given first-use progress saved, When Dashboard remounts, Then progress resumes from localStorage',
    async () => {
      // No holidays and no group assignments, so nothing but localStorage can complete a
      // step — which is precisely what this test is about. Steps now complete on org
      // evidence, so the default two-assigned-member stub would satisfy People on its own.
      stubDashboardApis({ noHolidays: true, unassignedMembers: true })
      const key = `${FIRST_USE_STORAGE_PREFIX}${mockUsers.organizationAdmin.organizationId}:${mockUsers.organizationAdmin.id}`
      localStorage.setItem(
        key,
        JSON.stringify({
          steps: { calendars: true, people: false, preview: false },
          updatedAt: '2026-07-27T00:00:00Z',
        }),
      )
      renderDashboard('ORGANIZATION_ADMIN')

      const cue = await screen.findByTestId('first-use-cue')
      expect(within(cue).getByText(/2 of 3/i)).toBeInTheDocument()
      expect(within(cue).getByTestId('first-use-step-2')).toHaveAttribute(
        'aria-current',
        'step',
      )
    },
  )

  it(
    '[P0] Given EMPLOYEE or MANAGER or PLATFORM_ADMIN, When Dashboard loads, Then first-use cue is absent',
    async () => {
      stubDashboardApis({ noHolidays: true })

      for (const role of ['EMPLOYEE', 'MANAGER', 'PLATFORM_ADMIN'] as const) {
        cleanup()
        renderDashboard(role)
        await screen.findByTestId('my-leaves-page')
        expect(screen.queryByTestId('first-use-cue')).not.toBeInTheDocument()
      }
    },
  )

  it(
    '[P1] Given dismissed first-use progress, When Dashboard loads, Then cue is hidden and Dashboard remains usable',
    async () => {
      stubDashboardApis({ noHolidays: true })
      const key = `${FIRST_USE_STORAGE_PREFIX}${mockUsers.organizationAdmin.organizationId}:${mockUsers.organizationAdmin.id}`
      localStorage.setItem(
        key,
        JSON.stringify({
          steps: { calendars: false, people: false, preview: false },
          dismissed: true,
          updatedAt: '2026-07-27T00:00:00Z',
        }),
      )
      renderDashboard('ORGANIZATION_ADMIN')

      await screen.findByTestId('my-leaves-page')
      expect(screen.queryByTestId('first-use-cue')).not.toBeInTheDocument()
      expect(screen.getByTestId('request-leave-btn')).toBeInTheDocument()
    },
  )

  it(
    '[P1] Given a mature organization, When Organization Admin opens Dashboard, Then first-use cue does not nag',
    async () => {
      stubDashboardApis()
      renderDashboard('ORGANIZATION_ADMIN')

      await screen.findByTestId('my-leaves-page')
      await waitFor(() => {
        expect(apiClient.getTeamMembers).toHaveBeenCalled()
        expect(apiClient.getPublicHolidays).toHaveBeenCalled()
      })
      expect(screen.queryByTestId('first-use-cue')).not.toBeInTheDocument()
      expect(screen.getByTestId('request-leave-btn')).toBeInTheDocument()
    },
  )

  it(
    '[P1] Given holidays and leave history but no group assignments, When Organization Admin opens Dashboard, Then first-use cue still shows',
    async () => {
      stubDashboardApis({ unassignedMembers: true })
      renderDashboard('ORGANIZATION_ADMIN')

      // Org looks mature on every signal except group assignment, which is
      // exactly what step 2 exists to finish — it must not suppress the cue.
      expect(await screen.findByTestId('first-use-cue')).toBeInTheDocument()
    },
  )

  it(
    '[P1] Given a mature org and no personal leave history, When Organization Admin opens Dashboard, Then cue stays suppressed',
    async () => {
      // A newly invited Organization Admin has no requests of their own; suppression must
      // follow org-scoped signals, never the caller's personal history.
      stubDashboardApis({ emptyHistory: true })
      renderDashboard('ORGANIZATION_ADMIN')

      await screen.findByTestId('my-leaves-page')
      await waitFor(() => {
        expect(apiClient.getRecentApprovalDecisions).toHaveBeenCalled()
      })
      expect(screen.queryByTestId('first-use-cue')).not.toBeInTheDocument()
    },
  )

  // -------------------------------------------------------------------------------------
  // Epic 11 retrospective action item 4 — first-use progress must be partial-failure-safe
  // and derived from real setup evidence, not from "the admin clicked the link".
  // -------------------------------------------------------------------------------------

  it(
    '[P0] Given one holiday endpoint fails, When an unstarted Organization Admin opens Dashboard, Then the cue still shows',
    async () => {
      stubDashboardApis()
      // Two groups; the second group's holiday lookup blows up. Previously Promise.all
      // rejected the whole signals query, showCue fell back to `hasStarted` (false for a
      // brand-new admin), and onboarding vanished for exactly the person who needed it.
      vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
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
      ])
      vi.spyOn(apiClient, 'getPublicHolidays').mockImplementation((groupId: number) =>
        groupId === 1
          ? Promise.resolve([])
          : Promise.reject(new ApiError(500, { status: 500, detail: 'Holiday lookup failed' })),
      )
      localStorage.removeItem(
        `${FIRST_USE_STORAGE_PREFIX}${mockUsers.organizationAdmin.organizationId}:${mockUsers.organizationAdmin.id}`,
      )

      renderDashboard('ORGANIZATION_ADMIN')

      expect(await screen.findByTestId('first-use-cue')).toBeInTheDocument()
    },
  )

  it(
    '[P0] Given every signal endpoint fails, When an unstarted Organization Admin opens Dashboard, Then the cue still shows',
    async () => {
      stubDashboardApis()
      const boom = () => Promise.reject(new ApiError(503, { status: 503, detail: 'Signal unavailable' }))
      vi.spyOn(apiClient, 'getWorkforceGroups').mockImplementation(boom)
      vi.spyOn(apiClient, 'getTeamMembers').mockImplementation(boom)
      vi.spyOn(apiClient, 'getRecentApprovalDecisions').mockImplementation(boom)
      localStorage.removeItem(
        `${FIRST_USE_STORAGE_PREFIX}${mockUsers.organizationAdmin.organizationId}:${mockUsers.organizationAdmin.id}`,
      )

      renderDashboard('ORGANIZATION_ADMIN')

      // Unknown must never read as "mature". Hiding onboarding from a new admin is the
      // costly failure; showing a dismissible cue to an established org is not.
      expect(await screen.findByTestId('first-use-cue')).toBeInTheDocument()
    },
  )

  it(
    '[P0] Given holidays already configured, When Organization Admin opens Dashboard, Then Calendars reads complete without ever clicking it',
    async () => {
      // Honest progress: the step reflects the organization's real configuration state,
      // not whether this particular admin happened to visit Settings.
      stubDashboardApis({ unassignedMembers: true })
      localStorage.removeItem(
        `${FIRST_USE_STORAGE_PREFIX}${mockUsers.organizationAdmin.organizationId}:${mockUsers.organizationAdmin.id}`,
      )

      renderDashboard('ORGANIZATION_ADMIN')

      const cue = await screen.findByTestId('first-use-cue')
      await waitFor(() => {
        expect(within(cue).getByTestId('first-use-step-1')).toHaveClass(
          'first-use-step-complete',
        )
      })
      // Calendars is done, so People is the live step — not step 1.
      expect(within(cue).getByTestId('first-use-step-2')).toHaveAttribute(
        'aria-current',
        'step',
      )
      expect(within(cue).getByText(/2 of 3/i)).toBeInTheDocument()
    },
  )

  it(
    '[P0] Given nothing is configured, When Organization Admin follows the Calendars link and returns, Then progress does not advance',
    async () => {
      // Navigating is not configuring. The old build recorded the step on click, so the cue
      // claimed setup progress the organization had never actually made.
      stubDashboardApis({ noHolidays: true, unassignedMembers: true })
      const storageKey = `${FIRST_USE_STORAGE_PREFIX}${mockUsers.organizationAdmin.organizationId}:${mockUsers.organizationAdmin.id}`
      localStorage.removeItem(storageKey)

      const user = userEvent.setup()
      renderDashboard('ORGANIZATION_ADMIN')

      const cue = await screen.findByTestId('first-use-cue')
      expect(within(cue).getByText(/1 of 3/i)).toBeInTheDocument()

      await user.click(within(cue).getByTestId('first-use-cta'))

      // The deep link still works…
      expect(await screen.findByTestId('settings-page')).toBeInTheDocument()
      // …but no completion was recorded for a step with no supporting evidence.
      const stored = localStorage.getItem(storageKey)
      expect(stored == null || JSON.parse(stored).steps.calendars === false).toBe(true)
    },
  )
})
