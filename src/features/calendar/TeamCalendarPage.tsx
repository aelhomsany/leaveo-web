import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError, getWorkforceGroups } from '../../api/client'
import type { DayOfWeek } from '../../api/generated/types'
import { useAuth } from '../../auth/useAuth'
import { LoadingState } from '../../components/ui/LoadingState'
import { PlusIcon } from '../../components/ui/icons'
import { RequestLeaveModal } from '../dashboard/RequestLeaveModal'
import { useMyLeaveRequests } from '../my-leaves/useMyLeaveRequests'
import { CalendarAgenda } from './CalendarAgenda'
import { CalendarLegend } from './CalendarLegend'
import { CalendarNav } from './CalendarNav'
import { CalendarOutTodayStrip } from './CalendarOutTodayStrip'
import { CalendarTimeline, type PendingOwnAbsence } from './CalendarTimeline'
import type { CalendarKind } from './calendarKinds'
import { nextActiveKind } from './calendarKinds'
import {
  addDays,
  addMonths,
  currentLocalDate,
  formatWeekLabel,
  formatYearMonthLabel,
  monthsForWeek,
  startOfWeek,
  yearMonthFromDate,
} from './calendarMonthUtils'
import { mergeCalendarMonths } from './mergeCalendarMonths'
import { useCalendarMonths } from './useCalendarMonth'
import './calendar.css'

type CalendarView = 'timeline' | 'agenda'
const NARROW_CALENDAR_QUERY = '(max-width: 900px)'

function initialCalendarView(): CalendarView {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'timeline'
  }
  return window.matchMedia(NARROW_CALENDAR_QUERY).matches ? 'agenda' : 'timeline'
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.problem.detail ?? error.problem.title ?? fallback
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

// A Timeline week can span two months (two queries). If only one failed,
// show its specific message; if more than one failed, a single message
// would misattribute the failure to the wrong month, so fall back to the
// generic loading-error copy instead.
function combinedErrorMessage(errors: unknown[], fallback: string): string {
  return errors.length === 1 ? errorMessage(errors[0], fallback) : fallback
}

export function TeamCalendarPage() {
  const { t, i18n } = useTranslation(['calendar', 'leaves'])
  const { user } = useAuth()
  const [initialDate] = useState(currentLocalDate)
  const [view, setView] = useState<CalendarView>(initialCalendarView)
  const [anchorDate, setAnchorDate] = useState(initialDate)
  const [workforceGroupId, setWorkforceGroupId] = useState<number | undefined>(undefined)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [requestModalOpen, setRequestModalOpen] = useState(false)
  // Roving-tabindex focus for the Timeline date header. Kept separate from
  // `selectedDate` so that merely Tab-ing/arrow-navigating the Timeline does
  // not silently set the Agenda's single-day filter (only an explicit Agenda
  // selection writes `selectedDate`).
  const [timelineFocusDate, setTimelineFocusDate] = useState<string | null>(null)
  // Which legend chip is lit. Lives here rather than in the timeline because the legend sits
  // outside the view switch — the state has to outlive a single CalendarTimeline render.
  const [activeKind, setActiveKind] = useState<CalendarKind | null>(null)
  const initializedFromServerToday = useRef(false)
  const lastServerToday = useRef<string | null>(null)
  const month = yearMonthFromDate(anchorDate)
  const workforceGroupsQuery = useQuery({
    queryKey: ['workforce-groups', user?.organizationId ?? user?.id],
    queryFn: getWorkforceGroups,
    enabled: user != null,
  })
  // Available independently of the calendar fetch, so a selected group's
  // weekend can inform the week boundary before calendar data loads. When no
  // group is selected, the viewer's own weekend isn't known yet at this
  // point (it comes from the calendar response itself), so this falls back
  // to a Sunday-start week — same as prior behavior for that case.
  const selectedGroupForWeekStart = workforceGroupsQuery.data?.find(
    (group) => group.id === workforceGroupId,
  )
  // An organization is provisioned with no Workforce Groups -- the Organization Admin creates them -- so
  // until then this filter would be a select whose only choice is "All groups". Hide the dead
  // control rather than showing a picker with nothing to pick.
  const hasGroupFilter =
    !workforceGroupsQuery.isSuccess || (workforceGroupsQuery.data?.length ?? 0) > 0
  const weekStart = startOfWeek(anchorDate, selectedGroupForWeekStart?.weekendDays ?? [])
  const requestedMonths = useMemo(
    () => view === 'timeline' ? monthsForWeek(weekStart) : [month],
    [month, view, weekStart],
  )
  const calendarQuery = useCalendarMonths(requestedMonths, workforceGroupId)
  const calendar = useMemo(() => (
    calendarQuery.data == null
      ? undefined
      : mergeCalendarMonths(
          calendarQuery.data,
          view === 'timeline' ? yearMonthFromDate(weekStart) : month,
        )
  ), [calendarQuery.data, month, view, weekStart])

  useEffect(() => {
    if (!calendar) {
      return undefined
    }

    lastServerToday.current = calendar.today
    if (initializedFromServerToday.current) {
      return undefined
    }

    if (calendar.today !== anchorDate) {
      const timer = window.setTimeout(() => {
        initializedFromServerToday.current = true
        setAnchorDate(calendar.today)
      }, 0)
      return () => window.clearTimeout(timer)
    }

    initializedFromServerToday.current = true
    return undefined
  }, [anchorDate, calendar])

  // The viewer's own PENDING requests, overlaid on the Timeline as dashed bars.
  // The calendar feed is approved-only, so these are synthesized from the
  // self-scoped /leave-requests response the viewer is always allowed to see —
  // no one else's pending requests can appear this way. Every figure (dates,
  // stored workingDays) comes from that response as returned.
  const myRequestsQuery = useMyLeaveRequests()
  const pendingOwnAbsences = useMemo<PendingOwnAbsence[]>(() => {
    const userId = user?.id
    if (userId == null) {
      return []
    }
    const feedRequestIds = new Set(
      (calendar?.absences ?? []).map((absence) => absence.requestId),
    )
    return (myRequestsQuery.data ?? [])
      .filter(
        (request) =>
          // Plan VUELTA / CANCEL-UI-VAL-008: this equality — not an exclusion list — is what
          // keeps a withdrawn request off the overlay. A CANCELLED request is terminal and is
          // never PENDING again, so it drops out here the moment the server says so.
          request.status === 'PENDING' &&
          request.id != null &&
          !feedRequestIds.has(request.id) &&
          Boolean(request.dateFrom) &&
          Boolean(request.dateTo),
      )
      .map((request) => ({
        requestId: request.id as number,
        userId,
        userFullName: user?.fullName,
        userInitials: user?.fullName
          ?.split(/\s+/)
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
        userColorKey: '',
        userWorkforceGroupId: 0,
        userWorkforceGroupName: user?.workforceGroupName ?? undefined,
        leaveTypeId: request.leaveTypeId,
        leaveTypeName: request.leaveTypeName,
        leaveTypeIcon: request.leaveTypeIcon,
        presence: 'OFF' as const,
        dateFrom: request.dateFrom as string,
        dateTo: request.dateTo as string,
        workingDays: request.workingDays ?? 0,
        workingDates: [],
        canViewRequestContext: true,
        viewerRelationship: 'SELF' as const,
        pending: true as const,
      }))
  }, [calendar?.absences, myRequestsQuery.data, user])

  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en-US'
  const selectedGroup = selectedGroupForWeekStart
  const weekendDays: DayOfWeek[] = selectedGroup?.weekendDays
    ?? calendar?.viewerWeekendDays
    ?? []
  const periodLabel = view === 'timeline'
    ? formatWeekLabel(weekStart, locale)
    : formatYearMonthLabel(month, locale)

  const changeMonth = (delta: number) => {
    setAnchorDate(`${addMonths(month, delta)}-01`)
    setSelectedDate(null)
  }

  const changeView = (nextView: CalendarView) => {
    if (nextView === view) {
      return
    }

    if (nextView === 'agenda' && selectedDate == null) {
      // Use the middle of the visible week so a cross-month week opens the
      // month containing most of its days instead of whichever weekday was
      // retained in the Timeline anchor.
      setAnchorDate(addDays(weekStart, 3))
    } else if (selectedDate != null) {
      setAnchorDate(selectedDate)
    }
    // Agenda has no filterable bars, so its legend is a plain key. Dropping the selection on
    // the way out keeps a filter from surviving invisibly and greeting the reader on return.
    if (nextView !== 'timeline') {
      setActiveKind(null)
    }
    setView(nextView)
  }

  const goToToday = () => {
    const authoritativeToday = lastServerToday.current ?? calendar?.today ?? initialDate
    setAnchorDate(authoritativeToday)
    setSelectedDate(null)
  }

  const changeWeek = (delta: number) => {
    setAnchorDate((currentDate) => addDays(currentDate, delta))
    setSelectedDate((currentDate) => (
      currentDate == null ? null : addDays(currentDate, delta)
    ))
  }

  const changeAgendaDate = (date: string | null) => {
    if (date != null && yearMonthFromDate(date) !== month) {
      setAnchorDate(date)
    }
    setSelectedDate(date)
  }

  const policyGroupName = selectedGroup?.name
    ?? calendar?.viewerWorkforceGroupName
    ?? t('filter.all')
  const weekendLabels = weekendDays.map((day) => t(`policy.days.${day}`))
  const weekendLabel = new Intl.ListFormat(locale, {
    style: 'long',
    type: 'conjunction',
  }).format(weekendLabels)

  return (
    <div className="page page-wide team-calendar-page" data-testid="team-calendar-page">
      <header className="page-header calendar-page-header calendar-workspace-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-sub">{t('subtitle')}</p>
        </div>
        <div className="calendar-header-actions calendar-command-deck">
          <button
            type="button"
            className="btn btn-primary calendar-request-button"
            data-testid="calendar-request-leave-btn"
            onClick={() => setRequestModalOpen(true)}
          >
            <PlusIcon size={16} /> {t('leaves:actions.requestLeave')}
          </button>
          <div
            className="calendar-view-toggle calendar-glass-control"
            role="group"
            aria-label={t('view.label')}
          >
            {(['timeline', 'agenda'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`calendar-view-button${view === option ? ' active' : ''}`}
                aria-pressed={view === option}
                onClick={() => changeView(option)}
              >
                {t(`view.${option}`)}
              </button>
            ))}
          </div>

          {hasGroupFilter && (
            <>
              <label className="sr-only" htmlFor="calendar-workforce-group-filter">
                {t('filter.label')}
              </label>
              <select
                id="calendar-workforce-group-filter"
                className="calendar-filter-select calendar-glass-control"
                value={workforceGroupId ?? ''}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setWorkforceGroupId(nextValue === '' ? undefined : Number(nextValue))
                }}
                aria-label={t('filter.label')}
                aria-invalid={workforceGroupsQuery.isError ? true : undefined}
              >
                <option value="">{t('filter.all')}</option>
                {workforceGroupsQuery.data?.map((group) => (
                  <option key={group.id} value={group.id} dir="auto">
                    {group.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            className="btn btn-primary calendar-today-button"
            onClick={goToToday}
          >
            {t('today')}
          </button>

          <CalendarNav
            period={view === 'timeline' ? 'week' : 'month'}
            label={periodLabel}
            onPrevious={() => (
              view === 'timeline'
                ? changeWeek(-7)
                : changeMonth(-1)
            )}
            onNext={() => (
              view === 'timeline'
                ? changeWeek(7)
                : changeMonth(1)
            )}
          />
        </div>
      </header>

      <CalendarOutTodayStrip />

      <CalendarLegend
        showPendingOwn={pendingOwnAbsences.length > 0}
        activeKind={activeKind}
        onToggleKind={
          view === 'timeline'
            ? (kind) => setActiveKind((current) => nextActiveKind(current, kind))
            : undefined
        }
      />

      {workforceGroupsQuery.isError ? (
        <p className="calendar-filter-error" role="status">
          {t('filter.loadError')}
        </p>
      ) : null}

      {calendarQuery.isPending && !calendarQuery.isError ? (
        <LoadingState
          label={t('loading')}
          variant="skeleton"
          testId="team-calendar-loading"
        >
          <div className="calendar-loading calendar-glass-card" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="calendar-loading-row" />
            ))}
          </div>
        </LoadingState>
      ) : null}

      {calendarQuery.isError ? (
        <div
          className="calendar-state calendar-error"
          data-testid="team-calendar-error"
          role="alert"
        >
          {combinedErrorMessage(calendarQuery.errors, t('loadError'))}
        </div>
      ) : null}

      {calendarQuery.isSuccess && calendar ? (
        <div className="calendar-section">
          <details className="calendar-policy-disclosure calendar-glass-card calendar-policy-card">
            <summary data-testid="calendar-why-days-differ">
              {t('policy.summary')}
            </summary>
            <div
              className="calendar-policy-panel"
              data-testid="calendar-why-days-differ-panel"
            >
              <p>
                {t('policy.weekend', {
                  group: policyGroupName,
                  days: weekendLabel || t('policy.noWeekend'),
                })}
              </p>
              <p>
                {t('policy.holidays', {
                  count: calendar.holidays.length,
                  group: workforceGroupId == null ? t('filter.all') : policyGroupName,
                })}
              </p>
              <p>{t('policy.displayOnly', { timezone: calendar.viewerTimezone })}</p>
            </div>
          </details>

          {view === 'agenda' && calendar.absences.length === 0 ? (
            <div className="calendar-empty-month">
              {t('emptyMonth')}
            </div>
          ) : null}

          {view === 'timeline' ? (
            <CalendarTimeline
              calendar={calendar}
              pendingOwnAbsences={pendingOwnAbsences}
              weekStart={weekStart}
              weekendDays={weekendDays}
              locale={locale}
              focusedDate={timelineFocusDate}
              onFocusedDateChange={setTimelineFocusDate}
              activeKind={activeKind}
              onClearKindFilter={() => setActiveKind(null)}
            />
          ) : (
            <CalendarAgenda
              calendar={calendar}
              month={month}
              anchorDate={anchorDate}
              weekendDays={weekendDays}
              selectedDate={selectedDate}
              onSelectedDateChange={changeAgendaDate}
              locale={locale}
            />
          )}
        </div>
      ) : null}

      <RequestLeaveModal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
      />
    </div>
  )
}
