import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CalendarAbsenceResponse } from '../../api/generated/types'
import { CalendarEventChip } from './CalendarEventChip'

/**
 * PRIV-UI-VAL-002 (Story 16.2). The server omits privacy-denied keys entirely, and TypeScript
 * will happily interpolate `undefined` into a template literal — so the only thing standing
 * between a redacted absence and a chip whose tooltip reads "undefined — undefined" is this
 * component's fallbacks. That is what these assert.
 */

const base: CalendarAbsenceResponse = {
  requestId: 10,
  userId: 2,
  userFullName: 'Sarah Chen',
  userInitials: 'SC',
  userColorKey: 'user-0',
  userWorkforceGroupId: 1,
  userWorkforceGroupName: 'US',
  leaveTypeId: 1,
  leaveTypeName: 'Annual Leave',
  leaveTypeIcon: 'leave',
  presence: 'OFF',
  dateFrom: '2026-06-10',
  dateTo: '2026-06-12',
  workingDays: 3,
  workingDates: ['2026-06-10', '2026-06-11', '2026-06-12'],
  dayParts: ['FULL', 'FULL', 'FULL'],
  canViewRequestContext: true,
  viewerRelationship: 'ORGANIZATION_ADMIN',
}

/** Delete keys outright — the server omits them, it does not send them as null. */
function omit(
  absence: CalendarAbsenceResponse,
  keys: (keyof CalendarAbsenceResponse)[],
): CalendarAbsenceResponse {
  const copy = { ...absence }
  for (const key of keys) {
    delete copy[key]
  }
  return copy
}

function renderChip(absence: CalendarAbsenceResponse) {
  return render(
    <MemoryRouter>
      <CalendarEventChip absence={absence} />
    </MemoryRouter>,
  )
}

describe('CalendarEventChip redaction', () => {
  it('renders no "undefined" in the title or accessible name when leave type is withheld', () => {
    // Rebuilt by omission rather than by setting the keys to undefined: the server does not send
    // them at all, and a test that assigns `undefined` would still pass with a DTO that ships them.
    const redacted = omit(base, ['leaveTypeName', 'leaveTypeIcon', 'leaveTypeId', 'canViewRequestContext'])
    renderChip({ ...redacted, viewerRelationship: 'ORGANIZATION_PEER' })

    const chip = screen.getByTestId('calendar-event-10')
    expect(chip.getAttribute('title')).not.toContain('undefined')
    expect(chip.getAttribute('aria-label')).not.toContain('undefined')
    expect(chip.getAttribute('title')).toContain('Sarah Chen')
    // Assert the real label, not just the absence of "undefined": this project's i18n renders a
    // missing key as an empty string, so a broken key would slip past a negative assertion alone.
    expect(chip.getAttribute('title')).toContain('Details hidden')
  })

  it('renders no "undefined" when identity itself is withheld', () => {
    const redacted = omit(base, ['userFullName', 'userInitials'])
    renderChip({ ...redacted, viewerRelationship: 'ORGANIZATION_PEER' })

    const chip = screen.getByTestId('calendar-event-10')
    expect(chip.getAttribute('title')).not.toContain('undefined')
    expect(chip.getAttribute('aria-label')).not.toContain('undefined')
    expect(chip.textContent).not.toContain('undefined')
    expect(chip.getAttribute('title')).toContain('A teammate')
    expect(chip.textContent).toBe('?')
  })

  it('is not an interactive link when request context is withheld', () => {
    const redacted = omit(base, ['canViewRequestContext'])
    renderChip({ ...redacted, viewerRelationship: 'ORGANIZATION_PEER' })

    // An absent key must read as "no", never as truthy — the chip must not offer a drill-in the
    // server would answer with a 404.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('is an interactive link when request context is granted', () => {
    renderChip(base)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/leave-requests/10')
  })
})
