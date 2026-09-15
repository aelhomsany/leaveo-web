import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  createReportExport,
  downloadReportExport,
  getReportExport,
  listReportExports,
  getLeaveTypes,
  getWorkforceGroups,
  retryReportExport,
  type ReportDefinitionKey,
} from '../../api/client'
import type {
  ReportExportResponse,
  ReportQueryRequest,
  ReportQueryResponse,
} from '../../api/generated/types'
import { useAuth } from '../../auth/useAuth'
import { useReportingCapability } from './useReportingCapability'
import { getBrowserTimezone } from '../../auth/timezone'
import { DateField } from '../../components/DateField'
import { HorizontalScrollRegion } from '../../components/ui/HorizontalScrollRegion'
import { LoadingState } from '../../components/ui/LoadingState'
import { PresenceBadge } from '../../components/ui/PresenceBadge'
import { useToast } from '../../components/ui/useToast'
import { availableTimezones } from '../../lib/timezones'
import {
  DEFAULT_REPORT_DEFINITION,
  REPORT_DEFINITIONS,
  REPORT_EXCEPTION_OPTIONS,
  balanceYearOptions,
  reportDefinitionFor,
  statusOptionsFor,
  type ReportDefinition,
  type ReportFilterKey,
} from './reportDefinitions'
import {
  formatOrdering,
  formatValue, summaryBreakdown,
  type ReportFormatContext,
} from './reportFormat'
import { ReportAnalytics } from './ReportAnalytics'
import { useReportQuery } from './useReportQuery'
import './reports.css'

const SCHEMA_VERSION = 1

/** Exception code the server refuses to combine with a group or leave-type filter. */
const GROUPLESS_EXCEPTION = 'USER_WITHOUT_WORKFORCE_GROUP'

type DraftReportView = {
  definitionKey: ReportDefinitionKey
  timezone: string
  from: string
  to: string
  workforceGroupId: string
  leaveTypeId: string
  status: string
  exceptionCode: string
  includeInactiveUsers: boolean
  balanceYear: string
  sort: string
  direction: 'ASC' | 'DESC'
}

type AppliedQuery = {
  definitionKey: ReportDefinitionKey
  request: ReportQueryRequest
}

function initialDraft(timezone: string): DraftReportView {
  return {
    definitionKey: DEFAULT_REPORT_DEFINITION.key,
    timezone,
    from: '',
    to: '',
    workforceGroupId: '',
    leaveTypeId: '',
    status: '',
    exceptionCode: '',
    includeInactiveUsers: false,
    balanceYear: '',
    sort: DEFAULT_REPORT_DEFINITION.defaultSort,
    direction: DEFAULT_REPORT_DEFINITION.defaultDirection,
  }
}

function supports(definition: ReportDefinition, filter: ReportFilterKey): boolean {
  return definition.filters.includes(filter)
}

function requestFromDraft(
  draft: DraftReportView,
  definition: ReportDefinition,
  page = 0,
): ReportQueryRequest {
  // `size` is deliberately omitted: the page size default and maximum are server
  // configuration (`leaveo.reporting.limits.*`), and a hardcoded value larger than a
  // deployment's maximum would make every query a 400. The server echoes the applied
  // size back, which is what the pagination math reads.
  const request: ReportQueryRequest = {
    schemaVersion: SCHEMA_VERSION,
    timezone: draft.timezone,
    sort: draft.sort,
    direction: draft.direction,
    page,
  }

  if (supports(definition, 'dateRange')) {
    if (draft.from) request.from = draft.from
    if (draft.to) request.to = draft.to
  }
  if (supports(definition, 'workforceGroup') && draft.workforceGroupId) {
    request.workforceGroupId = Number(draft.workforceGroupId)
  }
  if (supports(definition, 'leaveType') && draft.leaveTypeId) {
    request.leaveTypeId = Number(draft.leaveTypeId)
  }
  if (supports(definition, 'status') && draft.status) {
    request.status = draft.status
  }
  if (supports(definition, 'exceptionCode') && draft.exceptionCode) {
    request.exceptionCode = draft.exceptionCode
  }
  if (supports(definition, 'includeInactiveUsers')) {
    request.includeInactiveUsers = draft.includeInactiveUsers
  }
  // Omitted means the current balance year, which the server resolves and echoes back.
  if (supports(definition, 'balanceYear') && draft.balanceYear) {
    request.balanceYear = Number(draft.balanceYear)
  }

  return request
}

function resetForDefinition(
  draft: DraftReportView,
  definition: ReportDefinition,
): DraftReportView {
  return {
    ...draft,
    definitionKey: definition.key,
    from: supports(definition, 'dateRange') ? draft.from : '',
    to: supports(definition, 'dateRange') ? draft.to : '',
    workforceGroupId: supports(definition, 'workforceGroup')
      ? draft.workforceGroupId
      : '',
    leaveTypeId: supports(definition, 'leaveType') ? draft.leaveTypeId : '',
    // Request and carry-over statuses are different sets, so a status only survives a switch
    // when the new definition offers it too.
    status:
      supports(definition, 'status') && statusOptionsFor(definition).includes(draft.status)
        ? draft.status
        : '',
    exceptionCode: supports(definition, 'exceptionCode') ? draft.exceptionCode : '',
    includeInactiveUsers: supports(definition, 'includeInactiveUsers')
      ? draft.includeInactiveUsers
      : false,
    balanceYear: supports(definition, 'balanceYear') ? draft.balanceYear : '',
    sort: definition.defaultSort,
    direction: definition.defaultDirection,
  }
}

const EXPORT_POLL_INTERVAL_MS = 2_000
/** Ten minutes at the poll interval - the server's own per-attempt timeout. */
const EXPORT_POLL_LIMIT = 300
/** Failure codes the API emits; anything else falls back to the generic message. */
const EXPORT_FAILURE_CODES = new Set([
  'ARTIFACT_TOO_LARGE',
  'SNAPSHOT_UNREADABLE',
  'RENDER_FAILED',
])

export function ReportCenterPage() {
  const { t, i18n } = useTranslation(['reports', 'common'])
  const { showToast } = useToast()
  const { user } = useAuth()
  const timezone = user?.timezone || getBrowserTimezone()
  const [draft, setDraft] = useState<DraftReportView>(() => initialDraft(timezone))
  const [response, setResponse] = useState<ReportQueryResponse | null>(null)
  const [appliedQuery, setAppliedQuery] = useState<AppliedQuery | null>(null)
  const [lastAttemptedQuery, setLastAttemptedQuery] = useState<AppliedQuery | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'CSV' | 'XLSX'>('CSV')
  const reportingAccess = useReportingCapability()
  const [exportPolls, setExportPolls] = useState(0)
  const [exportJob, setExportJob] = useState<ReportExportResponse | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const { mutateAsync: runReportQuery } = useReportQuery()
  /*
    Owned here instead of read from the mutation's `isPending`. Under StrictMode the observer is
    torn down and remounted while the bootstrap query is still in flight, and the remounted one
    never sees the settle: the promise resolved, `setResponse` ran and the evidence rendered, yet
    every filter stayed disabled behind a button stuck on "Applying...". The component already
    sequences its own requests, so it owns this flag too rather than depending on observer
    lifecycle.
  */
  const [isReportPending, setIsReportPending] = useState(false)

  const createExportMutation = useMutation({
    mutationFn: ({
      definitionKey,
      request,
      format,
    }: AppliedQuery & { format: 'CSV' | 'XLSX' }) =>
      createReportExport(definitionKey, {
        format,
        // Exports always represent the whole applied result, never just the visible page.
        query: { ...request, page: 0 },
      }),
  })
  const retryExportMutation = useMutation({ mutationFn: retryReportExport })
  const exportPending =
    exportJob?.status === 'QUEUED' || exportJob?.status === 'GENERATING'
  const exportStatusQuery = useQuery({
    queryKey: ['report-export', exportJob?.id],
    queryFn: () => getReportExport(exportJob!.id),
    enabled: Boolean(exportJob?.id && exportPending),
    // Bounded: a job wedged behind a dead lease used to poll every two seconds forever, and kept
    // polling straight through a 403 or 404. EXPORT_POLL_LIMIT ticks is the 10-minute attempt
    // timeout, after which the job cannot still be legitimately generating.
    refetchInterval: (query) =>
      query.state.error || query.state.dataUpdateCount >= EXPORT_POLL_LIMIT
        ? false
        : EXPORT_POLL_INTERVAL_MS,
    retry: false,
  })
  const exportPollExhausted = exportPolls >= EXPORT_POLL_LIMIT

  // Rehydrates the job this page would otherwise have lost on a reload or a re-query. It is also
  // the only way to reach an export once billing is restricted, since no new query can run.
  const ownedExportsQuery = useQuery({
    queryKey: ['report-exports', 'owned'],
    queryFn: listReportExports,
    enabled: !exportJob,
    retry: false,
    staleTime: 30_000,
  })
  useEffect(() => {
    if (exportJob || !ownedExportsQuery.data?.length) return
    const recoverable = ownedExportsQuery.data.find(
      (job) =>
        job.status === 'QUEUED' || job.status === 'GENERATING' || job.status === 'READY',
    )
    if (recoverable) setExportJob(recoverable)
  }, [ownedExportsQuery.data, exportJob])

  useEffect(() => {
    if (exportStatusQuery.data) {
      setExportJob(exportStatusQuery.data)
      setExportError(null)
      setExportPolls((count) => count + 1)
    }
  }, [exportStatusQuery.data])

  // A new job starts its own budget.
  useEffect(() => {
    setExportPolls(0)
  }, [exportJob?.id])

  useEffect(() => {
    if (!exportStatusQuery.error) return
    setExportError(
      exportStatusQuery.error instanceof ApiError
        ? exportStatusQuery.error.problem.detail ?? t('reports:errors.exportStatusFailed')
        : t('reports:errors.exportStatusFailed'),
    )
  }, [exportStatusQuery.error, t])

  // react-i18next hands back a new `t` on every language change. Holding it in a ref
  // keeps `executeQuery` stable, so switching language no longer re-runs the bootstrap
  // effect and silently replaces the applied report with the default one.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  // Monotonic request id: a late-resolving query must not overwrite a newer one.
  const requestSeq = useRef(0)
  const bootstrapped = useRef(false)
  const previousPageRef = useRef<HTMLButtonElement>(null)
  const nextPageRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<'previous' | 'next' | null>(null)

  const workforceGroupsQuery = useQuery({
    queryKey: ['workforce-groups', 'report-filters'],
    queryFn: getWorkforceGroups,
  })
  const leaveTypesQuery = useQuery({
    queryKey: ['leave-types', 'report-filters'],
    queryFn: getLeaveTypes,
  })
  const definition = reportDefinitionFor(draft.definitionKey)
  const timezoneOptions = useMemo(() => availableTimezones(timezone), [timezone])
  const yearOptions = useMemo(() => balanceYearOptions(), [])

  const executeQuery = useCallback(
    async (next: AppliedQuery) => {
      const sequence = ++requestSeq.current
      setLastAttemptedQuery(next)
      setResponse(null)
      setRequestError(null)
      setDraftError(null)
      setIsReportPending(true)
      try {
        const result = await runReportQuery(next)
        if (sequence !== requestSeq.current) return
        setResponse(result)
        setAppliedQuery(next)
        // A pending job is deliberately kept: it still occupies this user's one concurrency slot,
        // so dropping the id stranded that slot until the job expired seven days later.
        setExportJob((current) =>
          current && (current.status === 'QUEUED' || current.status === 'GENERATING')
            ? current
            : null,
        )
        setExportError(null)
      } catch (error) {
        if (sequence !== requestSeq.current) return
        const message =
          error instanceof ApiError
            ? error.problem.detail ?? tRef.current('reports:errors.queryFailed')
            : tRef.current('reports:errors.queryFailed')
        setRequestError(message)
      } finally {
        // Only the newest request clears it: a superseded one would re-enable the form while
        // its replacement is still running.
        if (sequence === requestSeq.current) setIsReportPending(false)
      }
    },
    [runReportQuery],
  )

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    const firstDraft = initialDraft(timezone)
    void executeQuery({
      definitionKey: firstDraft.definitionKey,
      request: requestFromDraft(firstDraft, DEFAULT_REPORT_DEFINITION),
    })
  }, [executeQuery, timezone])

  // The requester's stored timezone can resolve after mount; keep the draft in step so
  // the control and the applied view never disagree about which zone was used.
  useEffect(() => {
    setDraft((current) =>
      current.timezone === timezone ? current : { ...current, timezone },
    )
  }, [timezone])

  const resultDefinition = useMemo(
    () => reportDefinitionFor(response?.definitionKey ?? appliedQuery?.definitionKey),
    [appliedQuery?.definitionKey, response?.definitionKey],
  )

  const updateDraft = <K extends keyof DraftReportView>(
    key: K,
    value: DraftReportView[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }))
    // Clear the guard message while the user is fixing the thing it complained about,
    // instead of leaving it on screen until the next Apply.
    setDraftError(null)
  }

  const handleDefinitionChange = (definitionKey: ReportDefinitionKey) => {
    setDraft((current) => resetForDefinition(current, reportDefinitionFor(definitionKey)))
    setDraftError(null)
  }

  const handleApply = () => {
    if (supports(definition, 'dateRange')) {
      if (!draft.from || !draft.to) {
        setDraftError(t('reports:errors.dateRangeRequired'))
        return
      }
      if (draft.from > draft.to) {
        setDraftError(t('reports:errors.dateRangeInvalid'))
        return
      }
    }
    void executeQuery({
      definitionKey: draft.definitionKey,
      request: requestFromDraft(draft, definition),
    })
  }

  const format: ReportFormatContext = {
    t,
    i18n,
    timeZone: response?.displayTimezone ?? appliedQuery?.request.timezone ?? timezone,
  }

  const page = response?.page ?? 0
  // `?? PAGE_SIZE` would leave a server-reported size of 0 in place and make
  // Math.ceil(total / 0) infinite, so Next Page would never disable.
  const size = response?.size && response.size > 0 ? response.size : 0
  const total = response?.total ?? 0
  const totalPages = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1

  const handlePage = (nextPage: number, origin: 'previous' | 'next') => {
    if (!appliedQuery || nextPage < 0 || nextPage >= totalPages) return
    restoreFocusRef.current = origin
    void executeQuery({
      definitionKey: appliedQuery.definitionKey,
      request: { ...appliedQuery.request, page: nextPage },
    })
  }

  const handleCreateExport = async () => {
    if (!appliedQuery) return
    setExportError(null)
    try {
      const result = await createExportMutation.mutateAsync({
        ...appliedQuery,
        format: exportFormat,
      })
      setExportJob(result)
      showToast(t('reports:exports.created'))
    } catch (error) {
      setExportError(
        error instanceof ApiError
          ? error.problem.detail ?? t('reports:errors.exportFailed')
          : t('reports:errors.exportFailed'),
      )
    }
  }

  const handleRetryExport = async () => {
    if (!exportJob?.id) return
    setExportError(null)
    try {
      const result = await retryExportMutation.mutateAsync(exportJob.id)
      setExportJob(result)
      showToast(t('reports:exports.retryQueued'))
    } catch (error) {
      setExportError(
        error instanceof ApiError
          ? error.problem.detail ?? t('reports:errors.exportRetryFailed')
          : t('reports:errors.exportRetryFailed'),
      )
    }
  }

  const handleDownloadExport = async () => {
    if (!exportJob?.id) return
    setExportError(null)
    try {
      const artifact = await downloadReportExport(exportJob.id)
      const url = URL.createObjectURL(artifact)
      const link = document.createElement('a')
      link.href = url
      link.download = exportJob.fileName
      // Appended before clicking: Firefox ignores click() on a detached anchor. The revoke is
      // deferred because doing it synchronously can cancel the transfer before the browser has
      // read the blob.
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      showToast(t('reports:exports.downloadStarted'))
    } catch (error) {
      setExportError(
        error instanceof ApiError
          ? error.problem.detail ?? t('reports:errors.exportDownloadFailed')
          : t('reports:errors.exportDownloadFailed'),
      )
    }
  }
  /**
   * Job state, its one valid next action, and the recovery guidance. Rendered both inside the
   * export card and, under restricted recovery, on its own - it used to live entirely inside the
   * `response && appliedView` gate, so the states AC3 exists to preserve were unreachable exactly
   * when billing was restricted and the bootstrap query was (correctly) denied.
   */
  const exportStatusPanel = (
    <>
          {exportJob && (
            <div
              className="reports-export-status"
              role="status"
              aria-live="polite"
              aria-busy={exportPending}
              data-testid="report-export-status"
            >
              <dl>
                <div>
                  <dt>{t('reports:exports.status')}</dt>
                  <dd>{t(`reports:exports.statuses.${exportJob.status}`)}</dd>
                </div>
                <div>
                  <dt>{t('reports:exports.format')}</dt>
                  <dd>{exportJob.format}</dd>
                </div>
                <div>
                  <dt>{t('reports:exports.rows')}</dt>
                  <dd>{formatValue(format, exportJob.rowCount)}</dd>
                </div>
                <div>
                  <dt>{t('reports:exports.expires')}</dt>
                  <dd>
                    <time dateTime={exportJob.expiresAt}>
                      {formatValue(format, exportJob.expiresAt)}
                    </time>
                  </dd>
                </div>
              </dl>
              {exportJob.failureReason && (
                <p>
                  {t(
                    `reports:exports.failures.${
                      EXPORT_FAILURE_CODES.has(exportJob.failureReason)
                        ? exportJob.failureReason
                        : 'UNKNOWN'
                    }`,
                  )}
                </p>
              )}
              {exportJob.status === 'EXPIRED' && (
                <p>{t('reports:exports.expiredGuidance')}</p>
              )}
              {exportPollExhausted && <p>{t('reports:exports.stalled')}</p>}
              <div className="reports-export-actions">
                {exportJob.downloadAvailable && exportJob.status === 'READY' && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => void handleDownloadExport()}
                  >
                    {t('reports:exports.download')}
                  </button>
                )}
                {exportJob.canRetry && exportJob.status === 'FAILED' && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={retryExportMutation.isPending}
                    onClick={() => void handleRetryExport()}
                  >
                    {retryExportMutation.isPending
                      ? t('reports:exports.retrying')
                      : t('reports:exports.retry')}
                  </button>
                )}
              </div>
            </div>
          )}
          {exportError && (
            <div className="reports-export-error" role="alert">
              <p>{exportError}</p>
              <p>{t('reports:exports.recoveryGuidance')}</p>
            </div>
          )}
    </>
  )

  const summary = response?.summary as unknown as Record<string, unknown> | undefined
  const rows = (response?.rows ?? []) as unknown as Array<Record<string, unknown>>
  const appliedView = response?.appliedView as unknown as Record<string, unknown> | undefined
  const provenance = response?.provenance
  const groupless = draft.exceptionCode === GROUPLESS_EXCEPTION
  const filterOptionsFailed =
    workforceGroupsQuery.isError || leaveTypesQuery.isError

  // Return focus to the control the user paged with; it unmounts while the next page
  // loads, so without this focus falls to <body> on every page turn.
  useEffect(() => {
    if (!restoreFocusRef.current) return
    // Also runs on failure: response stays null when a page turn fails, so focus used to drop to
    // <body> and a later success then stole it back.
    if (!response && !requestError) return
    const preferred =
      restoreFocusRef.current === 'next' ? nextPageRef.current : previousPageRef.current
    const fallback =
      restoreFocusRef.current === 'next' ? previousPageRef.current : nextPageRef.current
    restoreFocusRef.current = null
    if (preferred && !preferred.disabled) preferred.focus()
    else fallback?.focus()
  }, [response, requestError])

  /** `name (id)` for the ids the applied view echoes back, so scope is readable. */
  const describeAppliedValue = (key: string, value: unknown): string => {
    if (key === 'workforceGroupId') {
      const match = (workforceGroupsQuery.data ?? []).find(
        (group) => String(group.id) === String(value),
      )
      return match ? `${match.name} (${String(value)})` : formatValue(format, value)
    }
    if (key === 'leaveTypeId') {
      const match = (leaveTypesQuery.data ?? []).find(
        (leaveType) => String(leaveType.id) === String(value),
      )
      return match ? `${match.name} (${String(value)})` : formatValue(format, value)
    }
    return formatValue(format, value)
  }

  const dateRangeErrorId = draftError ? 'report-filter-error' : undefined
  const grouplessHintId = groupless ? 'report-groupless-hint' : undefined
  // An organization starts with no Workforce Groups (the Organization Admin creates them), which would
  // leave this optional filter as a select whose only choice is "All groups".
  const hasWorkforceGroupFilter =
    !workforceGroupsQuery.isSuccess || (workforceGroupsQuery.data?.length ?? 0) > 0

  return (
    <div className="page page-wide reports-page" data-testid="report-center-page">
      <header className="page-header reports-page-header">
        <div>
          <p className="panel-eyebrow">{t('reports:eyebrow')}</p>
          <h1 className="page-title">{t('reports:title')}</h1>
          <p className="page-sub">{t('reports:subtitle')}</p>
        </div>
      </header>

      <section className="card reports-filter-card" aria-labelledby="report-filter-title">
        <div className="card-header">
          <div>
            <h2 className="card-title" id="report-filter-title">
              {t('reports:filters.title')}
            </h2>
            <p className="reports-card-subtitle">{t(definition.descriptionKey)}</p>
          </div>
        </div>
        <form
          // noValidate on purpose: min/max below are kept so the native calendar greys
          // out impossible dates, but native constraint validation would block submit
          // and show a browser-language bubble instead of our localized, field-associated
          // message. The explicit checks in handleApply own the feedback.
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            handleApply()
          }}
        >
          <div className="panel-filter-grid">
            <div className="form-group">
              <label htmlFor="report-definition">{t('reports:filters.definition')}</label>
              <select
                id="report-definition"
                value={draft.definitionKey}
                disabled={isReportPending}
                onChange={(event) =>
                  handleDefinitionChange(event.target.value as ReportDefinitionKey)}
              >
                {REPORT_DEFINITIONS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {t(item.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="report-timezone">{t('reports:filters.timezone')}</label>
              <select
                id="report-timezone"
                value={draft.timezone}
                disabled={isReportPending}
                onChange={(event) => updateDraft('timezone', event.target.value)}
              >
                {timezoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>

            {supports(definition, 'balanceYear') && (
              <div className="form-group">
                <label htmlFor="report-balance-year">{t('reports:filters.balanceYear')}</label>
                <select
                  id="report-balance-year"
                  value={draft.balanceYear}
                  disabled={isReportPending}
                  onChange={(event) => updateDraft('balanceYear', event.target.value)}
                >
                  <option value="">{t('reports:filters.currentBalanceYear')}</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {supports(definition, 'dateRange') && (
              <>
                <div className="form-group">
                  <label htmlFor="report-from">{t('reports:filters.from')}</label>
                  <DateField
                    id="report-from"
                    value={draft.from}
                    max={draft.to || undefined}
                    disabled={isReportPending}
                    aria-invalid={draftError ? true : undefined}
                    aria-describedby={dateRangeErrorId}
                    onChange={(value) => updateDraft('from', value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="report-to">{t('reports:filters.to')}</label>
                  <DateField
                    id="report-to"
                    value={draft.to}
                    min={draft.from || undefined}
                    disabled={isReportPending}
                    aria-invalid={draftError ? true : undefined}
                    aria-describedby={dateRangeErrorId}
                    onChange={(value) => updateDraft('to', value)}
                  />
                </div>
              </>
            )}

            {supports(definition, 'workforceGroup') && hasWorkforceGroupFilter && (
              <div className="form-group">
                <label htmlFor="report-workforce-group">
                  {t('reports:filters.workforceGroup')}
                </label>
                <select
                  id="report-workforce-group"
                  value={draft.workforceGroupId}
                  disabled={isReportPending || groupless}
                  aria-describedby={grouplessHintId}
                  onChange={(event) => updateDraft('workforceGroupId', event.target.value)}
                >
                  <option value="">{t('reports:filters.allGroups')}</option>
                  {(workforceGroupsQuery.data ?? []).map((group) => (
                    <option key={group.id} value={String(group.id)} dir="auto">
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {supports(definition, 'leaveType') && (
              <div className="form-group">
                <label htmlFor="report-leave-type">{t('reports:filters.leaveType')}</label>
                <select
                  id="report-leave-type"
                  value={draft.leaveTypeId}
                  disabled={isReportPending || groupless}
                  aria-describedby={grouplessHintId}
                  onChange={(event) => updateDraft('leaveTypeId', event.target.value)}
                >
                  <option value="">{t('reports:filters.allLeaveTypes')}</option>
                  {(leaveTypesQuery.data ?? []).map((leaveType) => (
                    <option key={leaveType.id} value={String(leaveType.id)} dir="auto">
                      {leaveType.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {supports(definition, 'status') && (
              <div className="form-group">
                <label htmlFor="report-status">{t('reports:filters.status')}</label>
                <select
                  id="report-status"
                  value={draft.status}
                  disabled={isReportPending}
                  onChange={(event) => updateDraft('status', event.target.value)}
                >
                  <option value="">{t('reports:filters.allStatuses')}</option>
                  {statusOptionsFor(definition).map((status) => (
                    <option key={status} value={status}>
                      {t(`reports:values.${status}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {supports(definition, 'exceptionCode') && (
              <div className="form-group">
                <label htmlFor="report-exception-code">
                  {t('reports:filters.exceptionCode')}
                </label>
                <select
                  id="report-exception-code"
                  value={draft.exceptionCode}
                  disabled={isReportPending}
                  onChange={(event) => {
                    const exceptionCode = event.target.value
                    // The server rejects this code combined with a group or leave-type
                    // filter rather than silently dropping it, so clear both here.
                    setDraft((current) => ({
                      ...current,
                      exceptionCode,
                      workforceGroupId:
                        exceptionCode === GROUPLESS_EXCEPTION
                          ? ''
                          : current.workforceGroupId,
                      leaveTypeId:
                        exceptionCode === GROUPLESS_EXCEPTION ? '' : current.leaveTypeId,
                    }))
                    setDraftError(null)
                  }}
                >
                  <option value="">{t('reports:filters.allExceptions')}</option>
                  {REPORT_EXCEPTION_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {t(`reports:values.${code}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="report-sort">{t('reports:filters.sort')}</label>
              <select
                id="report-sort"
                value={draft.sort}
                disabled={isReportPending}
                onChange={(event) => updateDraft('sort', event.target.value)}
              >
                {definition.sortFields.map((field) => (
                  <option key={field} value={field}>
                    {t(`reports:sort.${field}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="report-direction">{t('reports:filters.direction')}</label>
              <select
                id="report-direction"
                value={draft.direction}
                disabled={isReportPending}
                onChange={(event) =>
                  updateDraft('direction', event.target.value as 'ASC' | 'DESC')}
              >
                <option value="ASC">{t('reports:values.ASC')}</option>
                <option value="DESC">{t('reports:values.DESC')}</option>
              </select>
            </div>

            {supports(definition, 'includeInactiveUsers') && (
              <label className="panel-checkbox" htmlFor="report-include-inactive">
                <input
                  id="report-include-inactive"
                  type="checkbox"
                  checked={draft.includeInactiveUsers}
                  disabled={isReportPending}
                  onChange={(event) =>
                    updateDraft('includeInactiveUsers', event.target.checked)}
                />
                <span>{t('reports:filters.includeInactive')}</span>
              </label>
            )}
          </div>

          {groupless && (
            <p className="panel-filter-hint" id="report-groupless-hint">
              {t('reports:filters.grouplessHint')}
            </p>
          )}
          {filterOptionsFailed && (
            <p
              className="field-error"
              role="alert"
              data-testid="report-filter-options-error"
            >
              {t('reports:errors.filterOptionsFailed')}
            </p>
          )}

          <div className="panel-filter-actions">
            {draftError && (
              <p className="field-error" role="alert" id="report-filter-error">
                {draftError}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={isReportPending}>
              {isReportPending
                ? t('reports:actions.applying')
                : t('reports:actions.apply')}
            </button>
          </div>
        </form>
      </section>

      {/*
        Mounted for the life of the page. A live region inserted at the same moment as
        its text is generally not announced, and `setResponse(null)` tears the results
        section down on every query — so the range has to be announced from out here.
      */}
      <p
        className="sr-only"
        aria-live="polite"
        data-testid="report-pagination-status"
      >
        {response
          ? t('reports:pagination.status', { page: page + 1, totalPages })
          : ''}
      </p>

      {isReportPending && (
        <LoadingState
          label={t('reports:loading')}
          variant="block"
          testId="report-loading"
        />
      )}

      {requestError && (
        <section className="reports-error" role="alert">
          <h2>{t('reports:errors.title')}</h2>
          <p>{requestError}</p>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              if (lastAttemptedQuery) void executeQuery(lastAttemptedQuery)
            }}
          >
            {t('common:actions.retry')}
          </button>
        </section>
      )}

      {!response && (exportJob || reportingAccess.data?.recovery === true) && (
        <section
          className="card reports-export-card"
          aria-labelledby="report-export-recovery-title"
          data-testid="report-export-recovery"
        >
          <div>
            <h2 id="report-export-recovery-title">{t('reports:exports.title')}</h2>
            <p>{t('reports:exports.recoveryDescription')}</p>
          </div>
          {exportStatusPanel}
        </section>
      )}

      {response && appliedView && (
        <>
          <section
            className="reports-applied card"
            aria-labelledby="report-applied-title"
            data-testid="report-applied-view"
          >
            <h2 id="report-applied-title">{t('reports:applied.title')}</h2>
            <dl>
              <div>
                <dt>{t('reports:applied.definition')}</dt>
                <dd>{t(resultDefinition.labelKey)}</dd>
              </div>
              {Object.entries(appliedView)
                .filter(([, value]) => value != null && value !== '')
                .map(([key, value]) => {
                  const labelKey = `reports:applied.${key}`
                  return (
                    <div key={key}>
                      {/* parseMissingKeyHandler returns '', so an unrecognized key
                          would render a value under a blank term without this. */}
                      <dt>{i18n.exists(labelKey) ? t(labelKey) : key}</dt>
                      <dd dir="auto">{describeAppliedValue(key, value)}</dd>
                    </div>
                  )
                })}
              <div>
                <dt>{t('reports:applied.ordering')}</dt>
                <dd data-testid="report-ordering">
                  {formatOrdering(format, response.ordering)}
                </dd>
              </div>
            </dl>
          </section>

          <p className="reports-as-of" data-testid="report-as-of">
            {t('reports:asOf')}{' '}
            <time dateTime={response.asOf}>
              {formatValue(format, response.asOf)}
            </time>{' '}
            <span className="reports-as-of-zone">
              ({format.timeZone})
            </span>
          </p>

          {summary && (
            <section className="reports-summary" aria-labelledby="report-summary-title">
              <h2 id="report-summary-title">{t('reports:summary.title')}</h2>
              <dl>
                {resultDefinition.summaryFields.map((field) => {
                  // A composite value is a set of rows, not a display number. Rendering it
                  // through the scalar `dd` turned it into one run-on headline-sized string.
                  const breakdown = summaryBreakdown(format, summary[field.key])
                  return (
                    <div
                      key={field.key}
                      data-testid={`report-summary-${field.key}`}
                      className={breakdown ? 'reports-summary-composite' : undefined}
                    >
                      <dt>{t(field.labelKey)}</dt>
                      {breakdown ? (
                        <dd className="reports-summary-breakdown">
                          <ul>
                            {breakdown.map((row) => (
                              <li key={row.key}>
                                <span className="reports-breakdown-label">
                                  {row.presence ? (
                                    <PresenceBadge
                                      presence={row.presence}
                                      label={row.label}
                                    />
                                  ) : (
                                    row.label
                                  )}
                                </span>
                                <span className="reports-breakdown-parts">
                                  {row.parts.map((part) => (
                                    <span
                                      key={part.key || row.key}
                                      className="reports-breakdown-part"
                                    >
                                      {part.label ? (
                                        <span className="reports-breakdown-part-label">
                                          {part.label}
                                        </span>
                                      ) : null}
                                      <span className="reports-breakdown-part-value">
                                        {part.value}
                                      </span>
                                    </span>
                                  ))}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      ) : (
                        <dd>{formatValue(format, summary[field.key])}</dd>
                      )}
                    </div>
                  )
                })}
              </dl>
            </section>
          )}

          <ReportAnalytics
            summary={response.summary}
            incomplete={provenance?.incomplete === true}
            format={format}
          />

          <section className="card reports-export-card" aria-labelledby="report-export-title">
            <div>
              <h2 id="report-export-title">{t('reports:exports.title')}</h2>
              <p>{t('reports:exports.description')}</p>
            </div>
            <div className="reports-export-controls">
              <div className="form-group">
                <label htmlFor="report-export-format">
                  {t('reports:exports.format')}
                </label>
                <select
                  id="report-export-format"
                  value={exportFormat}
                  disabled={createExportMutation.isPending}
                  onChange={(event) =>
                    setExportFormat(event.target.value as 'CSV' | 'XLSX')}
                >
                  <option value="CSV">{t('reports:exports.formats.CSV')}</option>
                  <option value="XLSX">{t('reports:exports.formats.XLSX')}</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                // One export per user: creating another while one is pending is a guaranteed 429
                // the page already had the state to prevent.
                disabled={createExportMutation.isPending || exportPending}
                onClick={() => void handleCreateExport()}
              >
                {createExportMutation.isPending
                  ? t('reports:exports.creating')
                  : t('reports:exports.create')}
              </button>
            </div>

            {exportStatusPanel}
          </section>

          {/* A band, not a rail: the results table declares a 1040px minimum against a
              1121px panel, so a 300px rail beside it would leave 797px and put the table
              into a permanent sideways scroll inside a narrowed column.

              It carries the page-versus-total figures and nothing that is already on this
              screen — the applied view, the as-of stamp and the summary have their own
              cards above, and repeating them here would be noise rather than support. */}
          <div className="support-band support-band-spaced" data-testid="report-results-band">
            <div className="support-note">
              <p className="support-note-title">{t('reports:band.setTitle')}</p>
              <dl className="support-note-list">
                <div className="support-note-kv">
                  <dt>{t('reports:band.matchedLabel')}</dt>
                  <dd data-testid="report-band-matched">{total}</dd>
                </div>
                <div className="support-note-kv">
                  <dt>{t('reports:band.shownLabel')}</dt>
                  <dd data-testid="report-band-shown">{rows.length}</dd>
                </div>
              </dl>
              <p className="support-note-body support-note-footnote">
                {t('reports:band.setFootnote')}
              </p>
            </div>
            <div className="support-note">
              <p className="support-note-title">{t('reports:band.readingTitle')}</p>
              <ul className="support-note-bullets">
                <li>{t('reports:band.readingTimezone')}</li>
                <li>{t('reports:band.readingOrdering')}</li>
              </ul>
            </div>
          </div>

          <section className="panel-results reports-results card" aria-labelledby="report-results-title">
            <div className="card-header panel-results-header">
              <div>
                <h2 className="card-title" id="report-results-title">
                  {t('reports:results.titleFor', {
                    definition: t(resultDefinition.labelKey),
                  })}
                </h2>
                <p className="reports-card-subtitle">
                  {t('reports:results.count', { count: total })}
                </p>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="dashboard-empty-state" data-testid="report-empty">
                <p>{t('reports:results.empty')}</p>
                {provenance?.incomplete && (
                  // An empty page over incomplete evidence is not a confirmed zero.
                  <p data-testid="report-empty-incomplete">
                    {t('reports:results.emptyIncomplete')}
                  </p>
                )}
              </div>
            ) : (
              <HorizontalScrollRegion
                labelledBy="report-results-title"
                describedById="report-results-scroll-hint"
                testId="report-results-region"
              >
                <table className="dashboard-table table-compact">
                  <thead>
                    <tr>
                      {resultDefinition.columns.map((column) => (
                        <th key={column.key} scope="col">{t(column.labelKey)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${String(row.rowType)}-${index}`} data-testid={`report-row-${index}`}>
                        {resultDefinition.columns.map((column) => (
                          // dir="auto" because names, groups and leave types are user
                          // data: they are never translated, and an LTR name inside an
                          // RTL document reorders its trailing punctuation without it.
                          <td key={column.key} dir="auto">
                            {formatValue(format, row[column.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HorizontalScrollRegion>
            )}
            <div className="panel-pagination">
              <button
                type="button"
                ref={previousPageRef}
                className="btn btn-outline btn-sm"
                disabled={isReportPending || page === 0}
                onClick={() => handlePage(page - 1, 'previous')}
              >
                {t('reports:pagination.previous')}
              </button>
              <p aria-hidden="true">
                {t('reports:pagination.status', { page: page + 1, totalPages })}
              </p>
              <button
                type="button"
                ref={nextPageRef}
                className="btn btn-outline btn-sm"
                disabled={isReportPending || page + 1 >= totalPages}
                onClick={() => handlePage(page + 1, 'next')}
              >
                {t('reports:pagination.next')}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
