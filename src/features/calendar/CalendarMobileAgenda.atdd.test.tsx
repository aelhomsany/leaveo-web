/**
 * Story 11.6 — ATDD RED scaffolds for Calendar and Mobile Agenda.
 * Cover: month/agenda view defaults, workforce group filter state, Timeline
 * keyboard dates, accessible names/semantics, server today/timezone, permitted
 * request-context navigation, week strip / day sections.
 * Do NOT mirror Jakarta month/workforceGroupId validation — API remains authoritative.
 * Unskip each case during bmad-dev-story when the corresponding AC ships.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import type { CalendarMonthResponse, LeaveRequestContextResponse } from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockWorkforceGroup } from '../../test/apiFixtures'
import { TeamCalendarPage } from './TeamCalendarPage'
import { mockCalendarMonth } from './calendarTestFixtures'
import { RequestContextPage } from '../leave-requests/RequestContextPage'

const workforceGroups = [
  mockWorkforceGroup({ id: 1, name: 'US' }),
  mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
]

const requestContext = {
  id: 10,
  leaveTypeId: 1,
  leaveTypeName: 'Annual Leave',
  leaveTypeIcon: 'leave',
  leaveTypeColor: '#093C5D',
  leaveTypeBackgroundColor: '#D6E8ED',
  leaveTypeBorderColor: '#0E4F75',
  dateFrom: '2026-06-10',
  dateTo: '2026-06-12',
  workingDays: 3,
  status: 'APPROVED',
  statusHint: 'Approved by Mina',
  declineReason: null,
  approverFirstName: 'Mina',
  requesterFullName: 'Sarah Chen',
} as LeaveRequestContextResponse

function mockNarrowViewport(narrow: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: narrow ? query === '(max-width: 900px)' : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function renderCalendar(initialEntries = ['/calendar']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/calendar" element={<TeamCalendarPage />} />
            <Route path="/leave-requests/:requestId" element={<RequestContextPage />} />
          </Routes>
        </MemoryRouter>
      </AuthTestProvider>
    </QueryClientProvider>,
  )
}

function stubCalendarApis(calendar: CalendarMonthResponse = mockCalendarMonth) {
  vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([...workforceGroups])
  vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(calendar)
}

describe('CalendarMobileAgenda ATDD — Story 11.6', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[P0] Given viewport ≥901px, When /calendar loads, Then Timeline is the default view', async () => {
    mockNarrowViewport(false)
    stubCalendarApis()
    renderCalendar()

    expect(await screen.findByTestId('calendar-timeline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('calendar-agenda')).not.toBeInTheDocument()
  })

  it('[P0] Given viewport ≤900px, When /calendar loads, Then Agenda is the default view with a week strip', async () => {
    mockNarrowViewport(true)
    stubCalendarApis()
    renderCalendar()

    expect(await screen.findByTestId('calendar-agenda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-week-strip')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-timeline')).not.toBeInTheDocument()
  })

  it('[P0] Given Agenda, When a week-strip day is selected, Then chronological day sections focus that date with availability text', async () => {
    mockNarrowViewport(true)
    stubCalendarApis()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCalendar()

    await screen.findByTestId('calendar-week-strip')
    await user.click(screen.getByTestId('calendar-week-day-2026-06-15'))

    const daySection = screen.getByTestId('calendar-agenda-day-2026-06-15')
    expect(daySection).toBeInTheDocument()
    expect(screen.getByTestId('calendar-availability-2026-06-15')).toHaveTextContent(/\d+\s+of\s+\d+\s+available/i)

    const sections = screen.getAllByTestId(/calendar-agenda-day-/)
    const dates = sections.map((el) => el.getAttribute('data-testid')?.replace('calendar-agenda-day-', '') ?? '')
    expect(dates).toEqual([...dates].sort())
  })

  it('[P0] Given a multi-day absence, When Agenda cards render, Then each card shows Day X of Y from stored range (no client recalculation)', async () => {
    mockNarrowViewport(true)
    stubCalendarApis()
    renderCalendar()

    await screen.findByTestId('calendar-agenda')
    // Sarah Chen Annual Leave 2026-06-10..12, workingDays: 3 → Day positions from stored dates
    expect(screen.getByText(/Day\s+1\s+of\s+3/i)).toBeInTheDocument()
  })

  it('[P0] Given Workforce Group Egypt selected on Timeline, When switching to Agenda and back, Then the filter selection persists', async () => {
    mockNarrowViewport(false)
    const calendarSpy = vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([...workforceGroups])
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCalendar()

    const filter = await screen.findByRole('combobox', { name: 'Workforce Group' })
    await screen.findByRole('option', { name: 'Egypt' })
    await user.selectOptions(filter, '2')

    await waitFor(() => {
      expect(calendarSpy).toHaveBeenCalledWith('2026-06', 2)
    })

    await user.click(screen.getByRole('button', { name: 'Agenda' }))
    expect(await screen.findByTestId('calendar-agenda')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Workforce Group' })).toHaveDisplayValue('Egypt')

    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(await screen.findByTestId('calendar-timeline')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Workforce Group' })).toHaveDisplayValue('Egypt')
  })

  it('[P0] Given Timeline date headers focused, When ArrowRight / Home / End are pressed, Then focus moves across ascending dates', async () => {
    mockNarrowViewport(false)
    stubCalendarApis()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCalendar()

    await screen.findByTestId('calendar-timeline')
    const firstDate = screen.getByTestId('calendar-timeline-date-2026-06-14')
    act(() => firstDate.focus())
    expect(firstDate).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByTestId('calendar-timeline-date-2026-06-15')).toHaveFocus()

    await user.keyboard('{End}')
    expect(screen.getByTestId('calendar-timeline-date-2026-06-20')).toHaveFocus()

    await user.keyboard('{Home}')
    expect(screen.getByTestId('calendar-timeline-date-2026-06-14')).toHaveFocus()
  })

  it('[P0] Given Agenda and Timeline surfaces, When absences render, Then chips expose accessible names (not title-only) and agenda region is labelled', async () => {
    mockNarrowViewport(true)
    stubCalendarApis()
    renderCalendar()

    const agenda = await screen.findByTestId('calendar-agenda')
    expect(agenda).toHaveAccessibleName(/agenda|team calendar/i)

    const permitted = screen.getByTestId('calendar-event-10')
    expect(permitted).toHaveAccessibleName(/Sarah Chen/i)
    expect(permitted.getAttribute('title')).not.toBe(permitted.getAttribute('aria-label'))

    const readOnly = screen.getByTestId('calendar-event-11')
    expect(readOnly).toHaveAccessibleName(/Omar Hassan/i)
    expect(readOnly).not.toHaveAttribute('tabindex')
  })

  it('[P0] Given API today differs from browser clock, When calendar loads, Then today highlight and Today action use server calendar.today', async () => {
    mockNarrowViewport(false)
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    stubCalendarApis({
      ...mockCalendarMonth,
      today: '2026-06-15',
      viewerTimezone: 'America/New_York',
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCalendar()

    await screen.findByTestId('calendar-timeline')
    // Navigate away, then Today must restore server today week — not Jun 1 browser clock
    await user.click(screen.getByTestId('calendar-next-week'))
    await user.click(screen.getByRole('button', { name: /Today/i }))

    expect(await screen.findByText(/Jun 14/i)).toBeInTheDocument()
    const todayHeader = screen.getByTestId('calendar-timeline-date-2026-06-15')
    expect(todayHeader).toHaveAttribute('aria-current', 'date')
  })

  it('[P0] Given a permitted absence, When the chip is activated, Then navigation opens /leave-requests/:id request context', async () => {
    mockNarrowViewport(false)
    stubCalendarApis({
      ...mockCalendarMonth,
      absences: [
        {
          ...mockCalendarMonth.absences[0],
          dateFrom: '2026-06-15',
          dateTo: '2026-06-17',
        },
      ],
    })
    vi.spyOn(apiClient, 'getLeaveRequestContext').mockResolvedValue(requestContext)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCalendar()

    await screen.findByTestId('calendar-timeline')
    await user.click(screen.getByTestId('calendar-event-10'))

    expect(await screen.findByRole('heading', { name: /Sarah Chen|Annual Leave|Request/i })).toBeInTheDocument()
  })

  it('[P1] Given Why days differ is opened, When the disclosure renders, Then weekend/holiday policy context is display-only', async () => {
    mockNarrowViewport(true)
    const calendarSpy = vi.spyOn(apiClient, 'getCalendarMonth').mockResolvedValue(mockCalendarMonth)
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([...workforceGroups])
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCalendar()

    await screen.findByTestId('calendar-agenda')
    const callsBeforeOpen = calendarSpy.mock.calls.length
    await user.click(screen.getByTestId('calendar-why-days-differ'))

    const panel = screen.getByTestId('calendar-why-days-differ-panel')
    expect(panel).toBeVisible()
    expect(panel).toHaveTextContent(/weekend|holiday|Fri|Sat|Sun/i)
    // Opening disclosure must not refetch calendar data
    expect(calendarSpy.mock.calls.length).toBe(callsBeforeOpen)
  })
})
