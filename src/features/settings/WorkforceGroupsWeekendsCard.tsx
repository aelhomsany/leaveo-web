import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isolate } from '../../i18n/bidi'
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import {
  cancelScheduledWeekendChange,
  getPublicHolidays,
  getTeamMembers,
  getWorkforceGroups,
  listWorkingWeekOverrides,
  patchWorkforceGroup,
  putWorkforceGroupWeekendDays,
  removeWorkingWeekOverride,
} from '../../api/client'
import type {
  DayOfWeek,
  WorkforceGroupResponse,
  WorkingWeekOverrideResponse,
} from '../../api/generated/types'
import { useAuth } from '../../auth/useAuth'
import { DateField } from '../../components/DateField'
import { availableTimezones } from '../../lib/timezones'
import { PublicHolidaysSection } from './PublicHolidaysSection'
import { WeekendDayChips } from './WeekendDayChips'
import { WorkforceGroupModal } from './WorkforceGroupModal'
import { WorkingDayStrip } from './WorkingDayStrip'
import { WorkingWeekOverrideModal, type OverrideCandidate } from './WorkingWeekOverrideModal'
import { CalendarIcon, CheckCircleIcon, PlusIcon } from '../../components/ui/icons'
import { WEEKEND_DAYS_DISPLAY } from './weekendDays'
import './group-tabs.css'

type WorkforceGroupsWeekendsCardProps = {
  requestedGroupId?: number | null
  discardSignal?: number
  onDirtyChange?: (dirty: boolean) => void
  // Returns whether the switch applied immediately (true) or was deferred
  // behind the unsaved-changes modal (false).
  onRequestGroupChange?: (groupId: number) => boolean
  onResolvedGroupId?: (groupId: number) => void
  onSuccess?: (message: string) => void
  onWarning?: (message: string) => void
}

const DAY_ORDER = new Map(
  WEEKEND_DAYS_DISPLAY.map(({ value }, index) => [value, index]),
)

function normalizedWeekendDays(days: DayOfWeek[]) {
  return [...days].sort(
    (left, right) => (DAY_ORDER.get(left) ?? 0) - (DAY_ORDER.get(right) ?? 0),
  )
}

function sameWeekendDays(left: DayOfWeek[], right: DayOfWeek[]) {
  const normalizedLeft = normalizedWeekendDays(left)
  const normalizedRight = normalizedWeekendDays(right)
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((day, index) => day === normalizedRight[index])
  )
}

function workingDaysOf(weekendDays: DayOfWeek[]) {
  return WEEKEND_DAYS_DISPLAY.map(({ value }) => value).filter((day) => !weekendDays.includes(day))
}

export function WorkforceGroupsWeekendsCard({
  requestedGroupId = null,
  discardSignal = 0,
  onDirtyChange,
  onRequestGroupChange,
  onResolvedGroupId,
  onSuccess,
  onWarning,
}: WorkforceGroupsWeekendsCardProps) {
  const { t, i18n } = useTranslation('settings')
  const { user, refreshUser } = useAuth()
  const orgId = user?.organizationId
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['workforce-groups', orgId] as const, [orgId])
  const membersQueryKey = useMemo(() => ['team-members', orgId] as const, [orgId])
  const overridesQueryKey = useMemo(() => ['working-week-overrides', orgId] as const, [orgId])

  const groupsQuery = useQuery({
    queryKey,
    queryFn: getWorkforceGroups,
    enabled: orgId != null,
  })

  const membersQuery = useQuery({
    queryKey: membersQueryKey,
    queryFn: getTeamMembers,
    enabled: orgId != null,
  })

  const [localActiveGroupId, setLocalActiveGroupId] = useState<number | null>(null)

  const groups = groupsQuery.data ?? []
  const selectedGroupId = requestedGroupId ?? localActiveGroupId
  const resolvedActiveGroupId = groups.some((group) => group.id === selectedGroupId)
    ? selectedGroupId
    : groups[0]?.id ?? null
  const activeGroup =
    groups.find((group) => group.id === resolvedActiveGroupId) ?? null

  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [overrideModalOpen, setOverrideModalOpen] = useState(false)
  // Personal working weeks need DISTRIBUTED_OPERATIONS. The plan catalog is server-side, so the
  // first refused write is what tells this card to stop offering the affordance.
  const [overridesUnavailable, setOverridesUnavailable] = useState(false)
  // Lazy-init from any group already resolved on first render (e.g. a warm
  // React Query cache on remount), so the impact panel doesn't flash "select
  // a weekend day" for one frame before the sync effect below corrects it.
  const [draftWeekendDays, setDraftWeekendDays] = useState<DayOfWeek[]>(
    () => activeGroup?.weekendDays ?? [],
  )
  // Tracks which group `draftWeekendDays` actually reflects. Without this,
  // there's a one-render window — after `groupsQuery` first resolves but
  // before the sync effect below runs — where `draftWeekendDays` is still its
  // pre-load value for a *different* (or no) group, and comparing it against
  // the just-loaded `activeGroup.weekendDays` below would read as a false
  // "unsaved change" the user never made.
  const [syncedGroupId, setSyncedGroupId] = useState<number | null>(
    () => activeGroup?.id ?? null,
  )
  // Empty means "from today in the group's zone" -- the server default. A later date turns the
  // save into a scheduled change and leaves today's pattern alone.
  const [changeFrom, setChangeFrom] = useState('')
  const [holidaysDirty, setHolidaysDirty] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    if (!activeGroup) {
      return
    }
    setDraftWeekendDays(activeGroup.weekendDays)
    setSyncedGroupId(activeGroup.id)
    setChangeFrom('')
    setHolidaysDirty(false)
    setSavedMessage('')
    // Group identity is the reset boundary; a same-group refetch must not erase
    // an in-progress draft or the durable post-save status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup?.id])

  useEffect(() => {
    if (!activeGroup) {
      return
    }
    setDraftWeekendDays(activeGroup.weekendDays)
    setSyncedGroupId(activeGroup.id)
    setChangeFrom('')
    setHolidaysDirty(false)
    setSavedMessage('')
    // This effect intentionally responds to the page-level discard signal. Server
    // refetches must not erase the durable save confirmation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardSignal])

  useEffect(() => {
    // A holiday add/edit is a distinct action from the weekend save below —
    // don't let a stale "weekend pattern saved" banner keep showing while the
    // user is midway through unrelated holiday work in the same group.
    if (holidaysDirty) {
      setSavedMessage('')
    }
  }, [holidaysDirty])

  useEffect(() => {
    if (
      requestedGroupId != null &&
      resolvedActiveGroupId != null &&
      requestedGroupId !== resolvedActiveGroupId &&
      !groupsQuery.isFetching
    ) {
      onResolvedGroupId?.(resolvedActiveGroupId)
    }
  }, [
    groupsQuery.isFetching,
    onResolvedGroupId,
    requestedGroupId,
    resolvedActiveGroupId,
  ])

  const weekendDirty =
    activeGroup != null &&
    syncedGroupId === activeGroup.id &&
    !sameWeekendDays(draftWeekendDays, activeGroup.weekendDays)
  const isDirty = weekendDirty || holidaysDirty

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(
    () => () => {
      onDirtyChange?.(false)
    },
    [onDirtyChange],
  )

  const activeMembers = useMemo(() => {
    if (!activeGroup || !membersQuery.data) {
      return null
    }
    return membersQuery.data.filter(
      (member) =>
        member.workforceGroupId === activeGroup.id &&
        member.status !== 'DEACTIVATED',
    )
  }, [activeGroup, membersQuery.data])
  const activeMemberCount = activeMembers?.length ?? null

  // The very query PublicHolidaysSection runs, under the very same key: React Query serves both
  // subscribers from one cache entry, so the rail costs no extra request and cannot disagree with
  // the list rendered below it.
  const holidaysQuery = useQuery({
    queryKey: ['public-holidays', orgId, activeGroup?.id] as const,
    queryFn: () => getPublicHolidays(activeGroup!.id!),
    enabled: orgId != null && activeGroup?.id != null,
  })

  // One org-wide read; the section below filters it to the active group so switching tabs costs
  // nothing and the tab counts (via overrideCount) and the list cannot drift apart.
  const overridesQuery = useQuery({
    queryKey: overridesQueryKey,
    queryFn: listWorkingWeekOverrides,
    enabled: orgId != null && groups.length > 0,
  })

  const countLabel = membersQuery.isPending
    ? t('groups.count.loading')
    : membersQuery.isError || activeMemberCount == null
      ? t('groups.count.unavailable')
      : t('groups.count.people', { count: activeMemberCount })

  const requestGroupChange = (groupId: number): boolean => {
    if (onRequestGroupChange) {
      return onRequestGroupChange(groupId)
    }
    setLocalActiveGroupId(groupId)
    return true
  }

  const activateTab = (groupId: number) => {
    const applied = requestGroupChange(groupId)
    if (!applied) {
      // A dirty draft deferred this behind the unsaved-changes modal — leave
      // focus where it is instead of desyncing it from the visible/ARIA
      // selection (the modal takes focus on its own once it opens).
      return
    }
    const tab = document.getElementById(`workforce-group-tab-${groupId}`)
    tab?.focus()
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const lastIndex = groups.length - 1
    let nextIndex: number | null = null

    if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = lastIndex
    } else {
      const forwardKey = i18n.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const backwardKey = i18n.dir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === forwardKey) {
        nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1
      } else if (event.key === backwardKey) {
        nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1
      }
    }

    if (nextIndex == null) {
      return
    }

    event.preventDefault()
    activateTab(groups[nextIndex].id)
  }

  const replaceGroupInCache = (updated: WorkforceGroupResponse) => {
    queryClient.setQueryData<WorkforceGroupResponse[]>(queryKey, (current) =>
      current?.map((group) => (group.id === updated.id ? updated : group)),
    )
  }

  const formatDate = (isoDate: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${isoDate}T00:00:00Z`),
    )

  const updateWeekendsMutation = useMutation({
    mutationFn: ({
      groupId,
      weekendDays,
      effectiveFrom,
    }: {
      groupId: number
      weekendDays: DayOfWeek[]
      effectiveFrom: string
    }) => putWorkforceGroupWeekendDays(groupId, weekendDays, effectiveFrom || undefined),
    onSuccess: (updated, { effectiveFrom }) => {
      replaceGroupInCache(updated)
      // The response's weekendDays are the pattern in force today. After a scheduled change they
      // are unchanged, so the draft snaps back to them and the status says when the change lands.
      setDraftWeekendDays(updated.weekendDays)
      setChangeFrom('')
      const scheduled = (updated.scheduledChanges ?? []).some(
        (change) => change.effectiveFrom === effectiveFrom,
      )
      setSavedMessage(
        scheduled
          ? t('groups.workingWeek.scheduledStatus', {
              name: isolate(updated.name),
              date: formatDate(effectiveFrom),
            })
          : t('groups.savedStatus', { name: isolate(updated.name) }),
      )
    },
    onError: () => {
      onWarning?.(t('groups.errors.updateWeekend'))
    },
  })

  const updateTimezoneMutation = useMutation({
    mutationFn: ({ groupId, timezone }: { groupId: number; timezone: string }) =>
      patchWorkforceGroup(groupId, { timezone }),
    onSuccess: (updated) => {
      replaceGroupInCache(updated)
      onSuccess?.(t('groups.timezone.saved', { name: isolate(updated.name), zone: updated.timezone }))
    },
    onError: () => {
      onWarning?.(t('groups.timezone.error'))
    },
  })

  const cancelChangeMutation = useMutation({
    mutationFn: ({ groupId, versionPublicId }: { groupId: number; versionPublicId: string; effectiveFrom: string }) =>
      cancelScheduledWeekendChange(groupId, versionPublicId),
    onSuccess: (updated, { effectiveFrom }) => {
      replaceGroupInCache(updated)
      onSuccess?.(t('groups.workingWeek.cancelled', { date: formatDate(effectiveFrom) }))
    },
    onError: () => {
      onWarning?.(t('groups.workingWeek.errors.cancel'))
    },
  })

  const removeOverrideMutation = useMutation({
    mutationFn: ({ versionPublicId }: { versionPublicId: string; fullName: string }) =>
      removeWorkingWeekOverride(versionPublicId),
    onSuccess: (_result, { fullName }) => {
      void queryClient.invalidateQueries({ queryKey: overridesQueryKey })
      // overrideCount on the group changed too.
      void queryClient.invalidateQueries({ queryKey })
      onSuccess?.(t('groups.overrides.removed', { name: isolate(fullName) }))
    },
    onError: () => {
      onWarning?.(t('groups.overrides.errors.remove'))
    },
  })

  if (groupsQuery.isPending) {
    return <p className="settings-card-loading" role="status">{t('groups.loading')}</p>
  }

  if (groupsQuery.isError) {
    return <p className="settings-card-error" role="alert">{t('groups.errors.load')}</p>
  }

  const hasGroups = groups.length > 0

  const localizedWeekendDays = draftWeekendDays.map((day) => t(`days.${day}`))
  const weekendList = new Intl.ListFormat(i18n.language, {
    style: 'long',
    type: 'conjunction',
  }).format(localizedWeekendDays)

  const listFormat = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' })
  const formatWeekend = (days: DayOfWeek[]) =>
    listFormat.format(normalizedWeekendDays(days).map((day) => t(`days.${day}`)))

  // The edit in progress, not the saved group: the rail answers "what am I about to do to this
  // group", so unticking a weekend day has to move the working-day figure before Save is pressed.
  const workingDaysPerWeek = 7 - draftWeekendDays.length
  const currentYear = new Date().getFullYear()
  const holidaysThisYear = holidaysQuery.data?.filter(
    (holiday) => holiday.dateFrom?.slice(0, 4) === String(currentYear),
  ).length
  const otherGroups = groups.filter((group) => group.id !== activeGroup?.id)

  const activeTimezone = activeGroup?.timezone ?? user?.organizationTimezone ?? 'UTC'
  // Show the zone being saved while the PATCH is in flight; on failure the select falls back to
  // the cached group, which is the reversion.
  const displayedTimezone = updateTimezoneMutation.isPending
    ? updateTimezoneMutation.variables.timezone
    : activeTimezone
  const timezoneOptions = availableTimezones(activeTimezone)
  const defaultNewGroupTimezone = user?.organizationTimezone ?? user?.timezone ?? 'UTC'

  const scheduledChanges = activeGroup?.scheduledChanges ?? []
  // Superseded versions are history: a person's newer override replaced them.
  const groupOverrides: WorkingWeekOverrideResponse[] = (overridesQuery.data ?? []).filter(
    (override) => override.workforceGroupId === activeGroup?.id && override.status !== 'SUPERSEDED',
  )
  const overrideCandidates: OverrideCandidate[] = (activeMembers ?? []).flatMap((member) =>
    member.publicId && member.fullName
      ? [{ publicId: member.publicId, fullName: member.fullName }]
      : [],
  )

  return (
    <div className="panel-with-aside">
      <section className="settings-card" data-testid="workforce-groups-weekends-card">
        <div className="card-section-header working-calendars-card-header">
          <div>
            <span className="card-section-title">{t('groups.title')}</span>
            <p className="settings-card-helper">{t('groups.helper')}</p>
          </div>
          {hasGroups ? (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="add-group-btn"
              onClick={() => setGroupModalOpen(true)}
            >
              <PlusIcon size={14} /> {t('groups.actions.add')}
            </button>
          ) : null}
        </div>

        {!hasGroups && (
          <div
            className="dashboard-empty-state workforce-groups-empty"
            data-testid="workforce-groups-empty-state"
          >
            <span aria-hidden="true">
              <CalendarIcon size={36} />
            </span>
            <h3>{t('groups.empty.title')}</h3>
            <p role="status">{t('groups.empty.body')}</p>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="add-group-btn"
              onClick={() => setGroupModalOpen(true)}
            >
              <PlusIcon size={16} /> {t('groups.empty.action')}
            </button>
          </div>
        )}

        {hasGroups && (
          <div
            className="group-tabs"
            role="tablist"
            aria-label={t('groups.aria.list')}
            aria-orientation="horizontal"
          >
            {groups.map((group, index) => {
              const groupCount = membersQuery.data?.filter(
                (member) =>
                  member.workforceGroupId === group.id &&
                  member.status !== 'DEACTIVATED',
              ).length
              const groupCountLabel = membersQuery.isPending
                ? t('groups.count.shortLoading')
                : membersQuery.isError || groupCount == null
                  ? t('groups.count.shortUnavailable')
                  : t('groups.count.short', { count: groupCount })
              return (
                <button
                  key={group.id}
                  id={`workforce-group-tab-${group.id}`}
                  type="button"
                  role="tab"
                  aria-label={group.name}
                  aria-selected={group.id === resolvedActiveGroupId}
                  aria-controls="workforce-group-panel"
                  aria-describedby={`workforce-group-tab-count-${group.id}`}
                  tabIndex={group.id === resolvedActiveGroupId ? 0 : -1}
                  className={`group-tab${group.id === resolvedActiveGroupId ? ' active' : ''}`}
                  onClick={() => requestGroupChange(group.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <span dir="auto">{group.name}</span>
                  {group.id === resolvedActiveGroupId && (
                    <span className="group-tab-selected-indicator">
                      <CheckCircleIcon size={14} />
                      {t('groups.selectedLabel')}
                    </span>
                  )}
                  <span className="group-tab-count" aria-hidden="true">
                    {groupCountLabel}
                  </span>
                  <span id={`workforce-group-tab-count-${group.id}`} className="sr-only">
                    {groupCountLabel}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {activeGroup && (
          <div
            id="workforce-group-panel"
            className="working-calendars-panel"
            role="tabpanel"
            aria-labelledby={`workforce-group-tab-${activeGroup.id}`}
          >
            <section
              className="working-calendars-impact"
              data-testid="working-calendars-impact"
              aria-labelledby="working-calendars-impact-title"
            >
              <div>
                <p className="working-calendars-step">{t('groups.impact.step')}</p>
                <h3 id="working-calendars-impact-title">
                  {t('groups.impact.title')}
                </h3>
                <p>
                  {draftWeekendDays.length > 0
                    ? t('groups.impact.summary', {
                        days: weekendList,
                        count:
                          activeMemberCount == null
                            ? t('groups.count.unknownValue')
                            : activeMemberCount,
                        name: activeGroup.name,
                      })
                    : t('groups.impact.noWeekend', { name: isolate(activeGroup.name) })}
                </p>
                <p className="working-calendars-history-note">
                  {t('groups.impact.history')}
                </p>
              </div>
              <div className="working-calendars-impact-meta">
                <span>{t('groups.impact.affected')}</span>
                <strong data-testid="working-calendars-affected-count">
                  {countLabel}
                </strong>
                <span className="working-calendars-policy-health">
                  {draftWeekendDays.length > 0
                    ? t('groups.impact.ready')
                    : t('groups.impact.needsWeekend')}
                </span>
              </div>
            </section>

            <div className="working-calendars-zone-row">
              <label htmlFor="working-calendars-timezone">{t('groups.timezone.label')}</label>
              <select
                id="working-calendars-timezone"
                data-testid="working-calendars-timezone"
                aria-label={t('groups.aria.timezoneFor', { name: activeGroup.name })}
                value={displayedTimezone}
                disabled={updateTimezoneMutation.isPending}
                onChange={(event) => {
                  if (event.target.value === activeTimezone) {
                    return
                  }
                  updateTimezoneMutation.mutate({
                    groupId: activeGroup.id,
                    timezone: event.target.value,
                  })
                }}
              >
                {timezoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="settings-card-helper-inline">
                {updateTimezoneMutation.isPending
                  ? t('groups.timezone.saving')
                  : t('groups.timezone.help')}
              </p>
            </div>

            <div className="settings-card-body">
              <div className="settings-col settings-col-weekends">
                <p className="settings-card-label">
                  {t('groups.weekendLabel')} <span dir="auto">{activeGroup.name}</span>
                </p>
                <WeekendDayChips
                  groupName={activeGroup.name}
                  weekendDays={draftWeekendDays}
                  disabled={updateWeekendsMutation.isPending}
                  onChange={(weekendDays) => {
                    setDraftWeekendDays(weekendDays)
                    setSavedMessage('')
                  }}
                />
                <div className="working-calendars-change-from">
                  <label htmlFor="working-calendars-change-from">
                    {t('groups.workingWeek.changeFrom')}
                  </label>
                  <DateField
                    id="working-calendars-change-from"
                    data-testid="working-calendars-change-from"
                    aria-label={t('groups.aria.changeFromFor', { name: activeGroup.name })}
                    value={changeFrom}
                    disabled={updateWeekendsMutation.isPending}
                    onChange={(value) => {
                      setChangeFrom(value)
                      setSavedMessage('')
                    }}
                  />
                  <p className="form-hint">{t('groups.workingWeek.changeFromHint')}</p>
                </div>
                <div className="working-calendars-save-row">
                  {draftWeekendDays.length === 0 ? (
                    <p className="working-calendars-validation" role="alert">
                      {t('groups.selectWeekend')}
                    </p>
                  ) : (
                    <p className="working-calendars-draft-state">
                      {weekendDirty ? t('groups.unsaved') : t('groups.saved')}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="working-calendars-save-btn"
                    disabled={
                      !weekendDirty ||
                      draftWeekendDays.length === 0 ||
                      updateWeekendsMutation.isPending
                    }
                    data-busy={updateWeekendsMutation.isPending ? 'true' : undefined}
                    onClick={() => {
                      if (updateWeekendsMutation.isPending) {
                        return
                      }
                      updateWeekendsMutation.mutate({
                        groupId: activeGroup.id,
                        weekendDays: draftWeekendDays,
                        effectiveFrom: changeFrom,
                      })
                    }}
                  >
                    {updateWeekendsMutation.isPending
                      ? t('groups.actions.saving')
                      : t('groups.actions.save')}
                  </button>
                </div>

                {scheduledChanges.length > 0 && (
                  <section
                    className="working-calendars-scheduled"
                    data-testid="working-calendars-scheduled-changes"
                    aria-labelledby="working-calendars-scheduled-title"
                  >
                    <h4 id="working-calendars-scheduled-title">
                      {t('groups.workingWeek.scheduledTitle')}
                    </h4>
                    <ul>
                      {scheduledChanges.map((change) => {
                        const sentence = t('groups.workingWeek.scheduledItem', {
                          date: formatDate(change.effectiveFrom),
                          days: formatWeekend(change.weekendDays),
                        })
                        const cancelling =
                          cancelChangeMutation.isPending &&
                          cancelChangeMutation.variables.versionPublicId === change.publicId
                        return (
                          <li key={change.publicId} data-testid={`scheduled-change-${change.publicId}`}>
                            <WorkingDayStrip workingDays={workingDaysOf(change.weekendDays)} label={sentence} />
                            <span aria-hidden="true">{sentence}</span>
                            <span className="working-calendars-row-actions">
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                aria-label={t('groups.workingWeek.cancelAria', {
                                  date: formatDate(change.effectiveFrom),
                                })}
                                disabled={cancelChangeMutation.isPending}
                                onClick={() =>
                                  cancelChangeMutation.mutate({
                                    groupId: activeGroup.id,
                                    versionPublicId: change.publicId,
                                    effectiveFrom: change.effectiveFrom,
                                  })
                                }
                              >
                                {cancelling ? t('groups.actions.saving') : t('groups.workingWeek.cancel')}
                              </button>
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}
              </div>
              <PublicHolidaysSection
                activeGroupId={activeGroup.id}
                activeGroupName={activeGroup.name}
                discardSignal={discardSignal}
                onDirtyChange={setHolidaysDirty}
                onSuccess={onSuccess}
                onWarning={onWarning}
              />
            </div>

            <section
              className="working-calendars-overrides"
              data-testid="working-calendars-overrides"
              aria-labelledby="working-calendars-overrides-title"
            >
              <div className="working-calendars-overrides-header">
                <div>
                  <h3 id="working-calendars-overrides-title">{t('groups.overrides.title')}</h3>
                  <p className="settings-card-helper-inline">{t('groups.overrides.help')}</p>
                </div>
                {overridesUnavailable ? (
                  <p className="form-hint" data-testid="overrides-unavailable">
                    {t('groups.overrides.unavailable')}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    data-testid="add-override-btn"
                    disabled={membersQuery.isPending}
                    onClick={() => setOverrideModalOpen(true)}
                  >
                    <PlusIcon size={14} /> {t('groups.overrides.add')}
                  </button>
                )}
              </div>
              {overridesQuery.isPending ? (
                <p className="form-hint" role="status">{t('groups.overrides.loading')}</p>
              ) : overridesQuery.isError ? (
                <p className="form-hint" role="alert">{t('groups.overrides.errors.load')}</p>
              ) : groupOverrides.length === 0 ? (
                <p className="form-hint" data-testid="overrides-empty">
                  {t('groups.overrides.empty', { name: isolate(activeGroup.name) })}
                </p>
              ) : (
                <ul data-testid="overrides-list">
                  {groupOverrides.map((override) => {
                    const pattern = formatWeekend(override.weekendDays)
                    const removing =
                      removeOverrideMutation.isPending &&
                      removeOverrideMutation.variables.versionPublicId === override.versionPublicId
                    return (
                      <li key={override.versionPublicId} data-testid={`override-${override.versionPublicId}`}>
                        <span className="working-calendars-row-name" dir="auto">{override.fullName}</span>
                        <WorkingDayStrip workingDays={workingDaysOf(override.weekendDays)} label={pattern} />
                        <span className="working-calendars-row-meta" aria-hidden="true">{pattern}</span>
                        <span className="working-calendars-row-meta">
                          {t('groups.overrides.columns.from')} {formatDate(override.effectiveFrom)}
                        </span>
                        <span className="working-calendars-row-meta">
                          {t(`groups.overrides.status.${override.status}`)}
                        </span>
                        <span className="working-calendars-row-actions">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            aria-label={t('groups.overrides.removeAria', { name: override.fullName })}
                            disabled={removeOverrideMutation.isPending}
                            onClick={() =>
                              removeOverrideMutation.mutate({
                                versionPublicId: override.versionPublicId,
                                fullName: override.fullName,
                              })
                            }
                          >
                            {removing ? t('groups.actions.saving') : t('groups.overrides.remove')}
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {savedMessage && (
              <p className="working-calendars-saved-status" role="status">
                <CheckCircleIcon size={18} /> {savedMessage}
              </p>
            )}
          </div>
        )}

        {groupModalOpen && (
          <WorkforceGroupModal
            isFirstGroup={!hasGroups}
            defaultTimezone={defaultNewGroupTimezone}
            onClose={() => setGroupModalOpen(false)}
            onSuccess={(message, newGroupId) => {
              void queryClient.invalidateQueries({ queryKey })
              // The first group adopts every still-ungrouped user server-side, so the
              // member counts this card renders are stale until the roster refetches.
              void queryClient.invalidateQueries({ queryKey: membersQueryKey })
              // The signed-in Organization Admin is one of those adopted users, so their cached
              // summary still says they have no workforce group. Screens that gate on
              // that (Request Leave) stay blocked until the summary is re-fetched.
              if (!hasGroups) {
                void refreshUser()
              }
              requestGroupChange(newGroupId)
              onSuccess?.(message)
            }}
            onWarning={onWarning}
          />
        )}

        {overrideModalOpen && activeGroup && (
          <WorkingWeekOverrideModal
            groupName={activeGroup.name}
            people={overrideCandidates}
            groupWeekendDays={activeGroup.weekendDays}
            onClose={() => setOverrideModalOpen(false)}
            onSuccess={(message) => {
              void queryClient.invalidateQueries({ queryKey: overridesQueryKey })
              void queryClient.invalidateQueries({ queryKey })
              onSuccess?.(message)
            }}
            onWarning={onWarning}
            onCapabilityUnavailable={() => setOverridesUnavailable(true)}
          />
        )}
      </section>

      {hasGroups && activeGroup && (
        <aside className="support-rail">
          {/* Weekends and holidays are edited one group at a time, so the two questions the editor
              cannot answer for itself are "how many people does this reach" and "what is the rest of
              the organization set to". */}
          <section className="support-note" aria-labelledby="calendars-impact-title">
            <h3 className="support-note-title" id="calendars-impact-title">
              {t('groups.railImpact.title')}
            </h3>
            <dl className="support-note-list">
              <div className="support-note-kv">
                <dt>{t('groups.impact.affected')}</dt>
                <dd data-testid="impact-affected-people">
                  {activeMemberCount == null ? '—' : activeMemberCount}
                </dd>
              </div>
              <div className="support-note-kv">
                <dt>{t('groups.railImpact.workingDays')}</dt>
                <dd data-testid="impact-working-days">{workingDaysPerWeek}</dd>
              </div>
              <div className="support-note-kv">
                <dt>{t('groups.railImpact.holidays', { year: currentYear })}</dt>
                <dd data-testid="impact-holidays">
                  {holidaysThisYear == null ? '—' : holidaysThisYear}
                </dd>
              </div>
              <div className="support-note-kv">
                <dt>{t('groups.overrides.title')}</dt>
                <dd data-testid="impact-overrides">
                  {overridesQuery.data == null ? '—' : groupOverrides.length}
                </dd>
              </div>
            </dl>
          </section>

          {otherGroups.length > 0 && (
            <section className="support-note" aria-labelledby="calendars-other-groups-title">
              <h3 className="support-note-title" id="calendars-other-groups-title">
                {t('groups.otherGroups.title')}
              </h3>
              <dl className="support-note-list">
                {otherGroups.map((group) => (
                  <div className="support-note-kv" key={group.id}>
                    <dt dir="auto">{group.name}</dt>
                    <dd className="support-note-kv-quiet">{formatWeekend(group.weekendDays ?? [])}</dd>
                  </div>
                ))}
              </dl>
              <p className="support-note-body">{t('groups.otherGroups.switchHint')}</p>
            </section>
          )}
        </aside>
      )}
    </div>
  )
}
