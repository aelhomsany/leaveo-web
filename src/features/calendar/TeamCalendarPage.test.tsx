import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type {
  CalendarMonthResponse,
  OutTodayResponse,
  RecentRequestResponse,
} from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockRecentRequestResponse, mockWorkforceGroup } from '../../test/apiFixtures'
import { TeamCalendarPage } from './TeamCalendarPage'
import { mockCalendarMonth } from './calendarTestFixtures'

const workforceGroups = [
  mockWorkforceGroup({ id: 1, name: 'US' }),
  mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
]

function calendarForMonth(month: string): CalendarMonthResponse {
  const [year, monthValue] = month.split('-').map(Number)
  const finalDay = new Date(Date.UTC(year, monthValue, 0)).getUTCDate()
  return {
    ...mockCalendarMonth,
    month,
    monthStart: `${month}-01`,
    monthEnd: `${month}-${String(finalDay).padStart(2, '0')}`,
    absences: month === '2026-06' ? mockCalendarMonth.absences : [],
    holidays: month === '2026-06' ? mockCalendarMonth.holidays : [],
  }
}

function renderTeamCalendarPage({ strict = false }: { strict?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const page = (
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
        <MemoryRouter>
          <TeamCalendarPage />
        </MemoryRouter>
      </AuthTestProvider>
    </QueryClientProvider>
  )

  return {
    ...render(strict ? <StrictMode>{page}</StrictMode> : page),
    queryClient,
  }
}

describe('TeamCalendarPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(workforceGroups)
    // Landing-page additions (Dashboard merge, 2026-09-01): the out-today strip
    // and the viewer's own pending-request overlay each fetch on mount.
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[P0/P1] opens on the current Timeline week in a full-bleed page', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)

    renderTeamCalendarPage()

    expect(screen.getByTestId('team-calendar-page')).toHaveClass('page', 'page-wide')
    expect(await screen.findByRole('heading', { name: 'Team Calendar' })).toBeInTheDocument()
    expect(await screen.findByText('Jun 14 – Jun 20, 2026')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-timeline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-scroll-wrap')).toBeInTheDocument()
  })

  it('[P1] opens the existing leave request flow from the calendar', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue([])
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await user.click(await screen.findByTestId('calendar-request-leave-btn'))
    expect(await screen.findByTestId('request-leave-modal')).toBeInTheDocument()
  })

  it('[P0] scopes and shares Workforce Group cache data by organization', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)

    const { queryClient } = renderTeamCalendarPage()

    await screen.findByRole('option', { name: 'Egypt' })
    expect(queryClient.getQueryData(['workforce-groups', 1])).toEqual(workforceGroups)
    expect(queryClient.getQueryData(['workforce-groups', 'calendar-filter'])).toBeUndefined()
  })

  it('[P0] switches to Agenda and refetches with yyyy-MM when navigating months', async () => {
    const calendarSpy = vi
      .spyOn(apiClient, 'getCalendarMonth')
      .mockImplementation(async (requestedMonth) => calendarForMonth(requestedMonth))
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-timeline')
    await user.click(screen.getByRole('button', { name: 'Agenda' }))
    expect(await screen.findByTestId('calendar-mini-month')).toHaveTextContent('June 2026')
    expect(screen.getByTestId('calendar-agenda')).toBeInTheDocument()

    await user.click(screen.getByTestId('calendar-next-month'))

    await waitFor(() => {
      expect(calendarSpy).toHaveBeenCalledWith('2026-07')
    })
    expect(await screen.findByTestId('calendar-mini-month')).toHaveTextContent('July 2026')
  })

  it('[P1] preserves a historical Timeline period when switching to Agenda', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(
      async (requestedMonth) => ({
        ...calendarForMonth(requestedMonth),
        today: '2026-07-15',
      }),
    )
    const user = userEvent.setup()

    renderTeamCalendarPage()

    expect(await screen.findByText('Jul 12 – Jul 18, 2026')).toBeInTheDocument()
    for (let week = 0; week < 4; week += 1) {
      await user.click(screen.getByTestId('calendar-prev-week'))
    }
    expect(await screen.findByText('Jun 14 – Jun 20, 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(await screen.findByTestId('calendar-mini-month')).toHaveTextContent('June 2026')
    expect(screen.getByText('Sarah Chen — Annual Leave')).toBeInTheDocument()
  })

  it('[P1] opens the majority month for a cross-month Timeline week', async () => {
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'))
    const julyVacation = {
      ...mockCalendarMonth.absences[0],
      requestId: 99,
      dateFrom: '2026-07-29',
      dateTo: '2026-07-30',
      workingDays: 2,
    }
    vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(
      async (requestedMonth) => ({
        ...calendarForMonth(requestedMonth),
        today: '2026-07-18',
        absences: requestedMonth === '2026-07' ? [julyVacation] : [],
      }),
    )
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-timeline')
    await user.click(screen.getByTestId('calendar-next-week'))
    await user.click(screen.getByTestId('calendar-next-week'))
    expect(await screen.findByText('Jul 26 – Aug 1, 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(await screen.findByTestId('calendar-mini-month')).toHaveTextContent('July 2026')
    expect(screen.getByText('Sarah Chen — Annual Leave')).toBeInTheDocument()
  })

  it('[P1] opens the selected Agenda date week when switching to Timeline', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(
      async (requestedMonth) => calendarForMonth(requestedMonth),
    )
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await user.click(await screen.findByRole('button', { name: 'Agenda' }))
    await user.click(screen.getByTestId('calendar-prev-month'))
    expect(await screen.findByTestId('calendar-mini-month')).toHaveTextContent('May 2026')
    await user.click(screen.getByTestId('calendar-day-2026-05-20'))

    await user.click(screen.getByRole('button', { name: 'Timeline' }))

    expect(await screen.findByText('May 17 – May 23, 2026')).toBeInTheDocument()
  })

  it('[P0] fetches both months for a cross-month Timeline week and deduplicates entries', async () => {
    const crossingAbsence = {
      ...mockCalendarMonth.absences[0],
      requestId: 88,
      dateFrom: '2026-06-30',
      dateTo: '2026-07-02',
      workingDays: 3,
    }
    const julyOnlyAbsence = {
      ...mockCalendarMonth.absences[1],
      requestId: 89,
      dateFrom: '2026-07-03',
      dateTo: '2026-07-03',
    }
    const calendarSpy = vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(
      async (requestedMonth) => ({
        ...calendarForMonth(requestedMonth),
        absences: requestedMonth === '2026-07'
          ? [crossingAbsence, julyOnlyAbsence]
          : [crossingAbsence],
      }),
    )
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-timeline')
    await user.click(screen.getByTestId('calendar-next-week'))
    await user.click(screen.getByTestId('calendar-next-week'))

    await waitFor(() => {
      expect(calendarSpy).toHaveBeenCalledWith('2026-07')
    })
    expect(await screen.findByText('Jun 28 – Jul 4, 2026')).toBeInTheDocument()
    expect(screen.getAllByTestId('calendar-event-88')).toHaveLength(1)
    expect(screen.getByTestId('calendar-event-89')).toBeInTheDocument()
  })

  it('[P0] reconciles the browser date to server today under Strict Mode', async () => {
    const calendarSpy = vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(
      async (requestedMonth) => ({
        ...calendarForMonth(requestedMonth),
        today: '2026-07-08',
      }),
    )

    renderTeamCalendarPage({ strict: true })

    expect(await screen.findByText('Jul 5 – Jul 11, 2026')).toBeInTheDocument()
    await waitFor(() => {
      expect(calendarSpy).toHaveBeenCalledWith('2026-07')
    })
  })

  it('[P1] Today retains the last server date while a boundary month is pending', async () => {
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'))
    let resolveJuly: ((calendar: CalendarMonthResponse) => void) | undefined
    const julyResponse = new Promise<CalendarMonthResponse>((resolve) => {
      resolveJuly = resolve
    })
    vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(async (requestedMonth) => {
      if (requestedMonth === '2026-07') {
        return julyResponse
      }
      return {
        ...calendarForMonth(requestedMonth),
        today: '2026-06-15',
      }
    })
    const user = userEvent.setup()

    renderTeamCalendarPage()

    expect(await screen.findByText('Jun 14 – Jun 20, 2026')).toBeInTheDocument()
    await user.click(screen.getByTestId('calendar-next-week'))
    await user.click(screen.getByTestId('calendar-next-week'))
    expect(await screen.findByTestId('team-calendar-loading')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Today' }))

    expect(await screen.findByText('Jun 14 – Jun 20, 2026')).toBeInTheDocument()
    resolveJuly?.({
      ...calendarForMonth('2026-07'),
      today: '2026-06-15',
    })
  })

  it('[P0] renders org-wide Agenda cards with All Groups selected by default', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByRole('option', { name: 'Egypt' })
    const filter = await screen.findByRole('combobox', { name: 'Workforce Group' })
    expect(filter).toHaveDisplayValue('All Groups')
    await user.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(await screen.findByText('Sarah Chen — Annual Leave')).toBeInTheDocument()
    expect(screen.getByText('Omar Hassan — Work From Home')).toBeInTheDocument()
  })

  it('[P0] loads Workforce Group options and resets through All Groups', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByRole('option', { name: 'Egypt' })
    const filter = await screen.findByRole('combobox', { name: 'Workforce Group' })
    expect(screen.getByRole('option', { name: 'All Groups' })).toHaveValue('')
    expect(await screen.findByRole('option', { name: 'US' })).toHaveValue('1')
    expect(screen.getByRole('option', { name: 'Egypt' })).toHaveValue('2')

    await user.selectOptions(filter, '2')
    expect(filter).toHaveDisplayValue('Egypt')
    await user.selectOptions(filter, '')
    expect(filter).toHaveDisplayValue('All Groups')
  })

  it('[P0] refetches with workforceGroupId and clears back to org-wide', async () => {
    const calendarSpy = vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByRole('option', { name: 'Egypt' })
    const filter = await screen.findByRole('combobox', { name: 'Workforce Group' })
    await user.selectOptions(filter, '2')
    await waitFor(() => {
      expect(calendarSpy).toHaveBeenCalledWith('2026-06', 2)
    })

    await user.selectOptions(filter, '')
    await waitFor(() => {
      expect(calendarSpy).toHaveBeenLastCalledWith('2026-06')
    })
  })

  it('[P0/P1] uses the selected group weekend definition in Agenda', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByRole('option', { name: 'Egypt' })
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Workforce Group' }),
      '2',
    )
    await user.click(screen.getByRole('button', { name: 'Agenda' }))

    expect(await screen.findByTestId('calendar-day-2026-06-12')).toHaveClass('weekend')
    expect(screen.getByTestId('calendar-day-2026-06-14')).not.toHaveClass('weekend')
  })

  it('[P0] keeps selected Workforce Group when navigating Agenda months', async () => {
    const calendarSpy = vi
      .spyOn(apiClient, 'getCalendarMonth')
      .mockImplementation(async (requestedMonth) => calendarForMonth(requestedMonth))
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByRole('option', { name: 'US' })
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Workforce Group' }),
      '1',
    )
    await user.click(screen.getByRole('button', { name: 'Agenda' }))
    await user.click(screen.getByTestId('calendar-next-month'))

    await waitFor(() => {
      expect(calendarSpy).toHaveBeenCalledWith('2026-07', 1)
    })
  })

  it('[P0] filters Agenda cards by day and clears selection with Show all', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await user.click(await screen.findByRole('button', { name: 'Agenda' }))
    const selectedDay = await screen.findByRole('button', { name: /June 11, 1 absence/i })
    await user.click(selectedDay)

    expect(selectedDay).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Thursday, June 11' })).toBeInTheDocument()
    expect(screen.getByText('Sarah Chen — Annual Leave')).toBeInTheDocument()
    expect(screen.queryByText('Omar Hassan — Work From Home')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all' }))
    expect(selectedDay).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: 'All days this month' })).toBeInTheDocument()
  })

  it('[P1] Today restores the current period and clears Agenda day selection', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(
      async (requestedMonth) => calendarForMonth(requestedMonth),
    )
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await user.click(await screen.findByRole('button', { name: 'Agenda' }))
    await user.click(screen.getByRole('button', { name: /June 11, 1 absence/i }))
    await user.click(screen.getByTestId('calendar-next-month'))
    await user.click(screen.getByRole('button', { name: 'Today' }))

    expect(await screen.findByTestId('calendar-mini-month')).toHaveTextContent('June 2026')
    expect(screen.getByRole('heading', { name: 'All days this month' })).toBeInTheDocument()
  })

  it('[P1] surfaces API problem details without rendering a success view', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockRejectedValue(
      new apiClient.ApiError(400, {
        title: 'Validation failed',
        detail: 'Viewer must belong to a Workforce Group to view the calendar.',
        status: 400,
      }),
    )

    renderTeamCalendarPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Viewer must belong to a Workforce Group to view the calendar.',
    )
    expect(screen.queryByTestId('calendar-timeline')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-agenda')).not.toBeInTheDocument()
  })

  it('[P1] gives a cross-month error precedence while another month is pending', async () => {
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'))
    let rejectJune: ((error: unknown) => void) | undefined
    let resolveJuly: ((calendar: CalendarMonthResponse) => void) | undefined
    const juneResponse = new Promise<CalendarMonthResponse>((_resolve, reject) => {
      rejectJune = reject
    })
    const julyResponse = new Promise<CalendarMonthResponse>((resolve) => {
      resolveJuly = resolve
    })
    vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(async (requestedMonth) => (
      requestedMonth === '2026-06' ? juneResponse : julyResponse
    ))

    renderTeamCalendarPage()

    expect(await screen.findByTestId('team-calendar-loading')).toBeInTheDocument()
    await act(async () => {
      rejectJune?.(new Error('June calendar is unavailable.'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('June calendar is unavailable.')
    expect(screen.queryByTestId('team-calendar-loading')).not.toBeInTheDocument()

    await act(async () => {
      resolveJuly?.({
        ...calendarForMonth('2026-07'),
        today: '2026-06-30',
      })
    })
  })

  it('[P2] keeps both empty-month messages visible but announces only the Agenda result', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockImplementation(
      async (requestedMonth) => calendarForMonth(requestedMonth),
    )
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await user.click(await screen.findByRole('button', { name: 'Agenda' }))
    await user.click(screen.getByTestId('calendar-next-month'))
    await screen.findByText('No approved leave scheduled this month.')

    expect(screen.getByText('No absences or holidays this month — full coverage.')).toBeVisible()
    const liveStatuses = screen.getAllByRole('status')
    expect(liveStatuses).toHaveLength(1)
    expect(liveStatuses[0]).toHaveTextContent(
      'No absences or holidays this month — full coverage.',
    )
  })

  it('[P1] keeps the calendar usable when group options fail', async () => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    vi.spyOn(apiClient, 'getWorkforceGroups').mockRejectedValue(new Error('Unavailable'))

    renderTeamCalendarPage()

    expect(await screen.findByText('Workforce Group options could not be loaded.')).toBeInTheDocument()
    const filter = screen.getByRole('combobox', { name: 'Workforce Group' })
    expect(filter).toHaveAttribute('aria-invalid', 'true')
    expect(await screen.findByTestId('calendar-timeline')).toBeInTheDocument()
    expect(within(filter).getByRole('option', { name: 'All Groups' })).toBeInTheDocument()
  })
})

/**
 * Story 10.10 — UXA-10 keyboard-reachable agenda alternative on Team Calendar.
 */
describe('TeamCalendarPage accessibility ATDD — Story 10.10', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(workforceGroups)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('[P1] exposes a keyboard-operable agenda view toggle with labelled agenda content', async () => {
    const user = userEvent.setup()
    renderTeamCalendarPage()

    const agendaToggle = await screen.findByRole('button', { name: /agenda/i })
    expect(agendaToggle).toBeInTheDocument()

    agendaToggle.focus()
    expect(agendaToggle).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /agenda/i })).toBeInTheDocument()
    })
  })
})

/**
 * Landing-page additions from the Dashboard merge (2026-09-01): the out-today
 * strip and the viewer's own pending-request overlay. Every figure asserted
 * here traces to a mocked API response the page already fetches.
 */
describe('TeamCalendarPage landing additions — Dashboard merge (2026-09-01)', () => {
  // An approved single-day OFF absence for a non-viewer colleague, cloned from
  // the fixture's shape so the type stays CalendarAbsenceResponse.
  const offOn = (requestId: number, userId: number, date: string) => ({
    ...mockCalendarMonth.absences[0],
    requestId,
    userId,
    userFullName: `Colleague ${userId}`,
    userInitials: `C${userId}`,
    dateFrom: date,
    dateTo: date,
    workingDays: 1,
    workingDates: [date],
  })

  const pendingOwnRequest: RecentRequestResponse = mockRecentRequestResponse({
    id: 77,
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    dateFrom: '2026-06-16',
    dateTo: '2026-06-17',
    workingDays: 2,
    status: 'PENDING',
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(workforceGroups)
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[P1] renders out-today rows from the dashboard feed, with privacy fallbacks', async () => {
    const outToday: OutTodayResponse[] = [
      { userId: 11, fullName: 'Omar Fields', initials: 'OF', presence: 'OFF', leaveTypeName: 'Annual Leave' },
      { userId: 12, fullName: 'Lena Waters', initials: 'LW', presence: 'WFH', leaveTypeName: 'Work From Home' },
      // Story 16.2 projection: identity and Leave Type may be absent.
      { userId: 13, presence: 'OFF' },
    ]
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue(outToday)

    renderTeamCalendarPage()

    const strip = screen.getByTestId('calendar-out-today')
    await waitFor(() => {
      expect(within(strip).getByTestId('calendar-out-today-11')).toBeInTheDocument()
    })
    expect(within(strip).getByText('Omar Fields')).toBeInTheDocument()
    expect(within(strip).getByText('Annual Leave')).toBeInTheDocument()
    expect(within(strip).getByText('Lena Waters')).toBeInTheDocument()
    const redactedRow = within(strip).getByTestId('calendar-out-today-13')
    expect(within(redactedRow).getByText('A teammate')).toBeInTheDocument()
    expect(within(redactedRow).getByText('Details hidden')).toBeInTheDocument()
  })

  it('[P1] takes WFH vs Off from the presence enum, not the leave type name', async () => {
    // PRESENCE-VAL-007 / DASH-VAL-011, re-homed from the deleted
    // OutTodaySidebar.test.tsx. The third row is the regression this exists
    // for: a leave type literally called "Work From Home" that the server
    // classified as OFF must still read Off — presence is the API's decision,
    // never a string match on the display name.
    const outToday: OutTodayResponse[] = [
      { userId: 11, fullName: 'Omar Fields', initials: 'OF', presence: 'OFF', leaveTypeName: 'Annual Leave' },
      { userId: 12, fullName: 'Lena Waters', initials: 'LW', presence: 'WFH', leaveTypeName: 'Work From Home' },
      { userId: 14, fullName: 'Nadia Rahman', initials: 'NR', presence: 'OFF', leaveTypeName: 'Work From Home' },
    ]
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue(outToday)

    renderTeamCalendarPage()

    const strip = screen.getByTestId('calendar-out-today')
    await waitFor(() => {
      expect(within(strip).getByTestId('calendar-out-today-11')).toBeInTheDocument()
    })
    const badgeOf = (userId: number) =>
      within(strip).getByTestId(`calendar-out-today-${userId}`).querySelector('.badge')
    expect(badgeOf(11)).toHaveTextContent('Off')
    expect(badgeOf(11)).toHaveClass('badge-off')
    expect(badgeOf(12)).toHaveTextContent('WFH')
    expect(badgeOf(12)).toHaveClass('badge-wfh')
    expect(badgeOf(14)).toHaveTextContent('Off')
    expect(badgeOf(14)).toHaveClass('badge-off')
  })

  it('[P2] shows the everyone-in empty state when nobody is out', async () => {
    renderTeamCalendarPage()

    expect(await screen.findByTestId('calendar-out-today-empty')).toHaveTextContent(
      'Everyone is in today!',
    )
  })

  it('[P1] surfaces an inline out-today error and recovers on retry', async () => {
    vi.spyOn(apiClient, 'getDashboardOutToday')
      .mockRejectedValueOnce(new Error('out today unavailable'))
      .mockResolvedValue([
        { userId: 11, fullName: 'Omar Fields', initials: 'OF', presence: 'OFF', leaveTypeName: 'Annual Leave' },
      ] satisfies OutTodayResponse[])
    const user = userEvent.setup()

    renderTeamCalendarPage()

    const strip = screen.getByTestId('calendar-out-today')
    await waitFor(() => {
      expect(within(strip).getByText('Unable to load out today.')).toBeInTheDocument()
    })

    await user.click(within(strip).getByRole('button', { name: 'Retry' }))

    expect(await within(strip).findByText('Omar Fields')).toBeInTheDocument()
  })

  it("[P0] overlays the viewer's own pending request as a dashed pending bar with its own accessible name", async () => {
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([pendingOwnRequest])

    renderTeamCalendarPage()

    const bar = await screen.findByTestId('calendar-event-77')
    expect(bar).toHaveClass('calendar-timeline-bar', 'calendar-timeline-bar--pending')
    // The pending overlay always renders as OFF presence; the --pending rule
    // must survive the .cal-event--off styling it stacks on.
    expect(bar).toHaveClass('cal-event--off')
    expect(bar).toHaveAccessibleName(
      /^Open your pending Annual Leave request, /,
    )
    // The legend explains the dashed treatment only while one is on screen.
    expect(screen.getByTestId('cal-legend-pending-own')).toHaveTextContent('Your pending request')
  })

  it('[P2] hides the pending legend item when the viewer has no pending request', async () => {
    renderTeamCalendarPage()

    await screen.findByTestId('calendar-timeline')
    expect(screen.queryByTestId('cal-legend-pending-own')).not.toBeInTheDocument()
  })

  it('[P1] drops a cancelled request from the viewer own pending overlay', async () => {
    // Plan VUELTA / CANCEL-UI-VAL-008. The overlay is composed client-side from the viewer's own
    // request list, so a withdrawn request would keep haunting the calendar if the composition
    // asked for anything looser than "still PENDING". Same fixture as the positive control above,
    // one field apart.
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([
      { ...pendingOwnRequest, status: 'CANCELLED' },
    ])

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-timeline')
    expect(screen.queryByTestId('calendar-event-77')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cal-legend-pending-own')).not.toBeInTheDocument()
  })

  it('[P0] keeps the pending overlay out of the coverage alert', async () => {
    // One approved colleague OFF on Wed Jun 17 plus the viewer's pending OFF on
    // the same day: if pending leaked into coverage, awayPeople.size would hit
    // the >=2 threshold and raise the alert.
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue({
      ...mockCalendarMonth,
      absences: [...mockCalendarMonth.absences, offOn(90, 4, '2026-06-17')],
    })
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([pendingOwnRequest])

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-event-77')
    expect(screen.queryByTestId('calendar-coverage-alert')).not.toBeInTheDocument()
  })

  it('[P1] still raises the coverage alert for two approved absences (control)', async () => {
    // Positive control for the exclusion test above: proves the alert testid
    // and threshold are live, so the previous assertion cannot pass vacuously.
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue({
      ...mockCalendarMonth,
      absences: [
        ...mockCalendarMonth.absences,
        offOn(90, 4, '2026-06-17'),
        offOn(91, 6, '2026-06-17'),
      ],
    })

    renderTeamCalendarPage()

    expect(await screen.findByTestId('calendar-coverage-alert')).toBeInTheDocument()
  })
})

/**
 * The legend doubles as the Timeline's filter (2026-09-01): each chip narrows the week to that
 * one kind, and pressing the lit chip clears back to everything.
 */
describe('TeamCalendarPage legend filter', () => {
  const offOn = (requestId: number, userId: number, date: string) => ({
    ...mockCalendarMonth.absences[0],
    requestId,
    userId,
    userFullName: `Colleague ${userId}`,
    userInitials: `C${userId}`,
    dateFrom: date,
    dateTo: date,
    workingDays: 1,
    workingDates: [date],
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(workforceGroups)
    vi.spyOn(apiClient, 'getDashboardOutToday').mockResolvedValue([])
    vi.spyOn(apiClient, 'getMyLeaveRequests').mockResolvedValue([])
    // Week of Jun 14–20: Omar Hassan WFH on the 15th (fixture) plus one Off day on the 17th,
    // and Founders Day on the 18th–19th — one of every kind in the opening week.
    vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue({
      ...mockCalendarMonth,
      absences: [mockCalendarMonth.absences[1], offOn(90, 4, '2026-06-17')],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[P1] narrows the timeline to one kind and clears on a second press', async () => {
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-event-11')
    expect(screen.getByTestId('calendar-event-90')).toBeInTheDocument()

    await user.click(screen.getByTestId('cal-legend-off'))

    expect(screen.getByTestId('cal-legend-off')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-event-90')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-event-11')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-holiday-column-2026-06-18')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('cal-legend-off'))

    expect(screen.getByTestId('cal-legend-off')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('calendar-event-11')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-holiday-column-2026-06-18')).toBeInTheDocument()
  })

  it('[P1] swaps the selection rather than adding to it', async () => {
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-event-11')
    await user.click(screen.getByTestId('cal-legend-off'))
    await user.click(screen.getByTestId('cal-legend-wfh'))

    expect(screen.getByTestId('cal-legend-off')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('cal-legend-wfh')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-event-11')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-event-90')).not.toBeInTheDocument()
  })

  it('[P1] offers a way back when a filter empties the week', async () => {
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-event-11')
    await user.click(screen.getByTestId('cal-legend-holiday'))

    expect(screen.getByTestId('calendar-timeline-empty-filtered')).toBeInTheDocument()
    // The holiday tint is what the reader asked to see, so it survives its own filter.
    expect(screen.getByTestId('calendar-holiday-column-2026-06-18')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all' }))

    expect(screen.queryByTestId('calendar-timeline-empty-filtered')).not.toBeInTheDocument()
    expect(screen.getByTestId('calendar-event-11')).toBeInTheDocument()
    expect(screen.getByTestId('cal-legend-holiday')).toHaveAttribute('aria-pressed', 'false')
  })

  it('[P1] drops the filter and the buttons when Agenda takes over', async () => {
    const user = userEvent.setup()

    renderTeamCalendarPage()

    await screen.findByTestId('calendar-event-11')
    await user.click(screen.getByTestId('cal-legend-off'))
    await user.click(screen.getByRole('button', { name: 'Agenda' }))

    // Agenda has no filterable bars, so its legend goes back to being a plain key.
    await screen.findByTestId('calendar-agenda')
    expect(screen.getByTestId('cal-legend-off').tagName).toBe('SPAN')
    // Scoped by testid, not by label: the Agenda's mini-month carries its own
    // "Calendar legend" landmark, so the page has two by that name in this view.
    expect(screen.getByTestId('cal-legend-off').closest('.cal-legend')).toHaveAttribute(
      'aria-label',
      'Calendar legend',
    )

    await user.click(screen.getByRole('button', { name: 'Timeline' }))

    // Returning to Timeline must not greet the reader with an invisible filter still on.
    await screen.findByTestId('calendar-event-11')
    expect(screen.getByTestId('cal-legend-off')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('calendar-event-90')).toBeInTheDocument()
  })
})
