import type { CalendarMonthResponse } from '../../api/generated/types'

// Story 16.3: the server now sends the final, privacy- and status-scoped available count for
// every day of the month -- components must render this directly rather than re-deriving it
// from audienceMemberCount and the absences list. Mirrors the fixture's own absences: Sarah
// Chen (OFF, June 10-12) is the only entry that drops availableCount below audienceMemberCount;
// Omar Hassan's WFH day does not reduce it.
const availableCountByDate: Record<string, number> = {}
for (let day = 1; day <= 30; day += 1) {
  const date = `2026-06-${String(day).padStart(2, '0')}`
  availableCountByDate[date] = day >= 10 && day <= 12 ? 7 : 8
}

export const mockCalendarMonth: CalendarMonthResponse = {
  month: '2026-06',
  monthStart: '2026-06-01',
  monthEnd: '2026-06-30',
  today: '2026-06-15',
  viewerTimezone: 'America/New_York',
  viewerWorkforceGroupId: 1,
  viewerWorkforceGroupName: 'US',
  viewerWeekendDays: ['SATURDAY', 'SUNDAY'],
  audienceMemberCount: 8,
  absences: [
    {
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
    },
    {
      requestId: 11,
      userId: 3,
      userFullName: 'Omar Hassan',
      userInitials: 'OH',
      userColorKey: 'user-1',
      userWorkforceGroupId: 2,
      userWorkforceGroupName: 'Egypt',
      leaveTypeId: 4,
      leaveTypeName: 'Work From Home',
      leaveTypeIcon: 'home',
      presence: 'WFH',
      dateFrom: '2026-06-15',
      dateTo: '2026-06-15',
      workingDays: 1,
      workingDates: ['2026-06-15'],
      dayParts: ['FULL'],
      canViewRequestContext: false,
      viewerRelationship: 'ORGANIZATION_PEER',
    },
  ],
  holidays: [
    {
      holidayId: 7,
      workforceGroupId: 1,
      workforceGroupName: 'US',
      name: 'Founders Day',
      dateFrom: '2026-06-18',
      dateTo: '2026-06-19',
    },
    {
      holidayId: 8,
      workforceGroupId: 2,
      workforceGroupName: 'Egypt',
      name: 'National Day',
      dateFrom: '2026-06-22',
      dateTo: '2026-06-22',
    },
  ],
  availableCountByDate,
}
