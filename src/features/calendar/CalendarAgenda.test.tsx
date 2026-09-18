import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { CalendarAbsenceResponse, CalendarMonthResponse } from '../../api/generated/types'
import { CalendarAgenda } from './CalendarAgenda'
import { mockCalendarMonth } from './calendarTestFixtures'

function AgendaHarness({ calendar = mockCalendarMonth }: { calendar?: CalendarMonthResponse }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  return (
    <MemoryRouter>
      <CalendarAgenda
        calendar={calendar}
        month="2026-06"
        weekendDays={calendar.viewerWeekendDays}
        selectedDate={selectedDate}
        onSelectedDateChange={setSelectedDate}
        locale="en-US"
      />
    </MemoryRouter>
  )
}

describe('CalendarAgenda', () => {
  it('[P0] filters inclusively across multi-day leave and clears on a repeated day click', async () => {
    const user = userEvent.setup()
    render(<AgendaHarness />)

    const day = screen.getByRole('button', { name: /June 11, 1 absence/i })
    await user.click(day)

    expect(day).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Sarah Chen — Annual Leave')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-event-10')).toHaveAccessibleName(
      'Open request context for Sarah Chen, Annual Leave, Off, Jun 10, 2026 – Jun 12, 2026',
    )
    expect(screen.queryByText('Omar Hassan — Work From Home')).not.toBeInTheDocument()

    await user.click(day)

    expect(day).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Omar Hassan — Work From Home')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-event-11')).toHaveAccessibleName(
      'Omar Hassan, Work From Home, WFH, Jun 15, 2026',
    )
  })

  it('[P0] includes a multi-day holiday on its final selected date', async () => {
    const user = userEvent.setup()
    render(<AgendaHarness />)

    await user.click(screen.getByRole('button', { name: /June 19, no absences, Founders Day/i }))

    expect(screen.getByRole('heading', { name: 'Friday, June 19' })).toBeInTheDocument()
    expect(screen.getByText('Founders Day — Public Holiday')).toBeInTheDocument()
    expect(screen.queryByText('Sarah Chen — Annual Leave')).not.toBeInTheDocument()
  })

  it('[P1] sorts absence and holiday cards by their start date', () => {
    const { container } = render(<AgendaHarness />)

    const itemIds = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="calendar-event-"], [data-testid^="calendar-holiday-"]'),
      (item) => item.dataset.testid,
    )
    expect(itemIds).toEqual([
      'calendar-event-10',
      'calendar-event-11',
      'calendar-holiday-7',
      'calendar-holiday-8',
    ])
  })

  it('[P1] explains full coverage when the selected day has no items', async () => {
    const user = userEvent.setup()
    render(<AgendaHarness />)

    await user.click(screen.getByRole('button', { name: /June 30, no absences/i }))

    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing on this day — full coverage.',
    )
  })

  it('[P1] renders the server-scoped available count, not a re-derived one', () => {
    // Sarah Chen's OFF absence overlaps June 11, so a naive client re-derivation would compute
    // audienceMemberCount(8) - offPeople.size(1) = 7. The server-provided availableCountByDate
    // is deliberately set to disagree (5) here -- proving the component renders that value
    // verbatim instead of recomputing it from audienceMemberCount and the absences list.
    const calendar: CalendarMonthResponse = {
      ...mockCalendarMonth,
      availableCountByDate: {
        ...mockCalendarMonth.availableCountByDate,
        '2026-06-11': 5,
      },
    }
    render(<AgendaHarness calendar={calendar} />)

    const availability = screen.getByTestId('calendar-availability-2026-06-11')
    expect(availability).toHaveTextContent('5 of 8 available')
    expect(availability).not.toHaveTextContent('7 of 8 available')
  })

  // AVAIL-UI-VAL-003 (P0): availableCountByDate is optional in the contract, so a day can arrive
  // with no entry. That means "never computed", not "nobody is available" -- defaulting the gap to
  // zero renders "0 of 8 available", the most alarming possible reading, as though the server had
  // asserted it.
  it('[P0] says the count is unavailable rather than rendering a missing day as zero', () => {
    const withoutTheDay = { ...mockCalendarMonth.availableCountByDate }
    delete withoutTheDay['2026-06-11']
    const calendar: CalendarMonthResponse = {
      ...mockCalendarMonth,
      availableCountByDate: withoutTheDay,
    }
    render(<AgendaHarness calendar={calendar} />)

    const availability = screen.getByTestId('calendar-availability-2026-06-11')
    expect(availability).not.toHaveTextContent('0 of 8 available')
    expect(availability).toHaveTextContent('Availability count unavailable')
  })
})

/**
 * Story 10.10 — UXA-10 accessible agenda representation (behavioral semantics).
 */
describe('CalendarAgenda accessibility ATDD — Story 10.10', () => {
  test('[P1] exposes a labelled agenda section with text-based list entries', () => {
    render(<AgendaHarness />)

    expect(screen.getByRole('region', { name: /agenda/i })).toBeInTheDocument()
    expect(screen.getByText('Sarah Chen — Annual Leave')).toBeInTheDocument()
    expect(screen.getByText('Omar Hassan — Work From Home')).toBeInTheDocument()
  })
})

/**
 * The scope flag (2026-09-01). "This month" was a muted uppercase label that read as a section
 * caption, so nothing on screen settled whether the list was filtered — and the mini-month's
 * today pill looked like a selection. The badge now states the scope and changes shape with it.
 */
describe('CalendarAgenda scope flag', () => {
  it('[P1] opens flagged as the whole month, with nothing selected', () => {
    render(<AgendaHarness />)

    const scope = screen.getByTestId('calendar-agenda-scope')
    expect(scope).toHaveTextContent('All days this month')
    expect(scope).toHaveClass('calendar-agenda-heading--month')
    expect(scope).not.toHaveClass('calendar-agenda-heading--day')
    // No "Show all" while nothing is filtered — the escape hatch belongs to the filtered state.
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument()
    // Both of the month's people are listed, which is what "all days" has to mean.
    expect(screen.getByText('Sarah Chen — Annual Leave')).toBeInTheDocument()
    expect(screen.getByText('Omar Hassan — Work From Home')).toBeInTheDocument()
  })

  it('[P1] flips the flag to one day when a day is picked, and back on Show all', async () => {
    const user = userEvent.setup()
    render(<AgendaHarness />)

    await user.click(screen.getByRole('button', { name: /June 11, 1 absence/i }))

    const scope = screen.getByTestId('calendar-agenda-scope')
    expect(scope).toHaveTextContent('One day only')
    expect(scope).toHaveClass('calendar-agenda-heading--day')
    expect(scope).not.toHaveClass('calendar-agenda-heading--month')

    await user.click(screen.getByRole('button', { name: 'Show all' }))

    expect(screen.getByTestId('calendar-agenda-scope')).toHaveTextContent('All days this month')
    expect(screen.getByTestId('calendar-agenda-scope')).toHaveClass(
      'calendar-agenda-heading--month',
    )
  })
})

/**
 * Plan MEDIA. The agenda names the half: a fractional day count says how much of a day somebody is
 * away, and only dayParts -- read by the date's position in workingDates -- says which half. An
 * absence with no parts reads as whole days, which is what it was.
 */
describe('CalendarAgenda day-part chip — Plan MEDIA', () => {
  // Tuesday 2 June 2026, one working day.
  function oneDay(overrides: Partial<CalendarAbsenceResponse>): CalendarAbsenceResponse {
    return {
      ...mockCalendarMonth.absences[0],
      requestId: 20,
      dateFrom: '2026-06-02',
      dateTo: '2026-06-02',
      workingDays: 1,
      workingDates: ['2026-06-02'],
      dayParts: ['FULL'],
      ...overrides,
    }
  }

  function withoutDayParts(absence: CalendarAbsenceResponse): CalendarAbsenceResponse {
    const copy: Partial<CalendarAbsenceResponse> = { ...absence }
    delete copy.dayParts
    return copy as CalendarAbsenceResponse
  }

  function renderWith(absence: CalendarAbsenceResponse) {
    render(<AgendaHarness calendar={{ ...mockCalendarMonth, absences: [absence], holidays: [] }} />)
    return screen.getByTestId('calendar-event-20')
  }

  // MEDIA-UI-VAL-007. A half day names its half, beside the fractional count rather than instead
  // of it.
  it.each([
    ['FIRST_HALF', 'Morning'],
    ['SECOND_HALF', 'Afternoon'],
  ] as const)('[P1] names a %s absence "%s"', (part, label) => {
    const card = renderWith(oneDay({ workingDays: 0.5, dayParts: [part] }))

    expect(within(card).getByTestId('calendar-agenda-day-part')).toHaveTextContent(
      new RegExp(`^${label}$`),
    )
    expect(card).toHaveTextContent('Jun 2, 2026 · 0.5 working days')
  })

  // MEDIA-UI-VAL-007. A whole day gets no chip -- not even one saying "Whole day".
  it('[P1] shows no chip for a whole day', () => {
    const card = renderWith(oneDay({ dayParts: ['FULL'] }))

    expect(within(card).queryByTestId('calendar-agenda-day-part')).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent(/Whole day|Morning|Afternoon/)
  })

  // MEDIA-UI-VAL-007. No parts at all: a pre-MEDIA request whose response has no dayParts, an empty
  // list, and the shape TeamCalendarPage gives its optimistic pending overlay (dayParts and
  // workingDates both empty -- an overlay that today is only handed to the timeline).
  it.each([
    ['a pre-MEDIA request with no dayParts', withoutDayParts(oneDay({}))],
    ['an empty dayParts list', oneDay({ dayParts: [] })],
    ['the pending-overlay shape', oneDay({ workingDays: 0.5, workingDates: [], dayParts: [] })],
  ])('[P1] shows no chip for %s', (_label, absence) => {
    const card = renderWith(absence)

    expect(within(card).queryByTestId('calendar-agenda-day-part')).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent(/Whole day|Morning|Afternoon/)
  })

  // MEDIA-UI-VAL-007. Across a range each date reads its own part: the afternoon start on the first
  // day, nothing in the middle, the morning end on the last day.
  it('[P1] reads the part for the date being shown across a multi-day absence', async () => {
    const user = userEvent.setup()
    renderWith(
      oneDay({
        dateFrom: '2026-06-01',
        dateTo: '2026-06-03',
        workingDays: 2,
        workingDates: ['2026-06-01', '2026-06-02', '2026-06-03'],
        dayParts: ['SECOND_HALF', 'FULL', 'FIRST_HALF'],
      }),
    )
    const chip = () =>
      within(screen.getByTestId('calendar-event-20')).queryByTestId('calendar-agenda-day-part')

    // Unfiltered, the card sits on its first day.
    expect(chip()).toHaveTextContent(/^Afternoon$/)

    await user.click(screen.getByRole('button', { name: 'June 2, 1 absence' }))
    expect(screen.getByTestId('calendar-event-20')).toBeInTheDocument()
    expect(chip()).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'June 3, 1 absence' }))
    expect(chip()).toHaveTextContent(/^Morning$/)
  })
})
