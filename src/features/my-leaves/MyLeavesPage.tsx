import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { RecentRequestResponse } from '../../api/generated/types'
import { useAuth } from '../../auth/useAuth'
import { LoadingState } from '../../components/ui/LoadingState'
import { PlusIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/useToast'
import { useApprovalCapability } from '../approvals/useApprovalCapability'
import { usePendingApprovalCount } from '../approvals/usePendingApprovalCount'
import { BalanceCard } from '../dashboard/BalanceCard'
import { FirstUseCue } from '../dashboard/FirstUseCue'
import { RequestLeaveModal } from '../dashboard/RequestLeaveModal'
import {
  formatDateRange,
  localizedRequestStatusHint,
} from '../dashboard/leaveRequestFormatting'
import { useDashboardBalances } from '../dashboard/useDashboardBalances'
import { useDashboardOutToday } from '../dashboard/useDashboardOutToday'
import { useDashboardUpcoming } from '../dashboard/useDashboardUpcoming'
import { useOnboarding } from '../onboarding/useOnboarding'
import { CancelLeaveModal } from './CancelLeaveModal'
import { cancelVariantFor, type CancelLeaveVariant } from './cancellation'
import { MyLeavesAttention } from './MyLeavesAttention'
import { MyLeavesFilters } from './MyLeavesFilters'
import { MyLeavesHistory } from './MyLeavesHistory'
import { MyLeavesSupportRail } from './MyLeavesSupportRail'
import { STATUS_FILTERS, type MyLeavesStatusFilter } from './statusFilters'
import { useCancelLeave, useRequestLeaveCancellation } from './useCancelLeave'
import { useMyLeaveRequests } from './useMyLeaveRequests'
import './my-leaves.css'

const SEARCH_INPUT_ID = 'my-leaves-search'
const QUERY_COMMIT_DELAY_MS = 500

type CancelTarget = {
  requestId: number
  variant: CancelLeaveVariant
  leaveTypeName: string
  dateRange: string
  daysToRestore: number
  daysForfeited: number
}

function statusFilterFrom(value: string | null): MyLeavesStatusFilter {
  return STATUS_FILTERS.includes(value as MyLeavesStatusFilter)
    ? (value as MyLeavesStatusFilter)
    : 'ALL'
}

function numericRequestId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName
}

function timeGreetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'greetings.morning'
  if (hour < 17) return 'greetings.afternoon'
  return 'greetings.evening'
}

export function MyLeavesPage() {
  const { t, i18n } = useTranslation([
    'leaves',
    'layout',
    'dashboard',
    'common',
    'onboarding',
  ])
  const { user } = useAuth()
  const isOrganizationAdmin = user?.role === 'ORGANIZATION_ADMIN'
  const [modalOpen, setModalOpen] = useState(false)
  const [expandedRequestId, setExpandedRequestId] = useState<number | null>(null)
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  // The in-flight flag is owned here rather than read from the mutation: React Query's
  // `isPending` stalls under StrictMode's double-invoke and leaves the confirm button stuck
  // busy with a 200 already in the network tab (CANCEL-UI-VAL-007). The ref is the authority
  // for the re-entrancy guard so two clicks in one tick cannot both pass it; the state copy
  // exists only to re-render.
  const cancelInFlight = useRef(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const greetingRef = useRef<HTMLHeadingElement>(null)
  const { showToast } = useToast()
  const balancesQuery = useDashboardBalances()
  const historyQuery = useMyLeaveRequests()
  const outTodayQuery = useDashboardOutToday()
  const upcomingQuery = useDashboardUpcoming()
  const pendingCountQuery = usePendingApprovalCount()
  const approvalCapability = useApprovalCapability()
  const cancelMutation = useCancelLeave()
  const reviewRequestMutation = useRequestLeaveCancellation()
  // Ambient cue — keeps the 30s cache; only the guided page itself forces a re-read.
  const onboardingQuery = useOnboarding(isOrganizationAdmin)
  const pendingCount = pendingCountQuery.data?.count ?? 0
  const guidedOnboarding = onboardingQuery.isSuccess
    && onboardingQuery.data.presentationEnabled !== false

  const urlQuery = searchParams.get('q') ?? ''
  const statusFilter = statusFilterFrom(searchParams.get('status'))
  const requestIdParam = searchParams.get('requestId')
  const requestedId = numericRequestId(requestIdParam)

  // Live query drives filtering immediately; the URL is updated on a debounced
  // commit so Back/Forward restores prior searches without a per-keystroke flood.
  const [liveQuery, setLiveQuery] = useState(urlQuery)
  useEffect(() => {
    setLiveQuery(urlQuery)
  }, [urlQuery])

  useEffect(() => {
    if (liveQuery === urlQuery) {
      return
    }
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      if (liveQuery.trim()) {
        next.set('q', liveQuery)
      } else {
        next.delete('q')
      }
      setSearchParams(next)
    }, QUERY_COMMIT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [liveQuery, urlQuery, searchParams, setSearchParams])

  // Strip URL params that cannot be honored so a shared link never keeps a
  // silently-ignored status or whitespace-only search around forever.
  useEffect(() => {
    const rawStatus = searchParams.get('status')
    const rawQuery = searchParams.get('q')
    const invalidStatus =
      rawStatus != null &&
      !STATUS_FILTERS.includes(rawStatus as MyLeavesStatusFilter)
    const blankQuery = rawQuery != null && rawQuery.trim() === ''
    if (!invalidStatus && !blankQuery) {
      return
    }
    const next = new URLSearchParams(searchParams)
    if (invalidStatus) {
      next.delete('status')
    }
    if (blankQuery) {
      next.delete('q')
    }
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const filteredRequests = useMemo(() => {
    if (!historyQuery.data) {
      return []
    }
    const normalizedQuery = liveQuery.trim().toLocaleLowerCase(i18n.language)

    return historyQuery.data.filter((request) => {
      if (statusFilter !== 'ALL' && request.status !== statusFilter) {
        return false
      }
      if (!normalizedQuery) {
        return true
      }

      const localizedHint = localizedRequestStatusHint(request, t)
      const statusLabel = request.status
        ? t(`common:status.${request.status.toLowerCase()}`)
        : ''
      const searchableText = [
        request.leaveTypeName,
        formatDateRange(
          request.dateFrom ?? '',
          request.dateTo ?? '',
          i18n.language,
        ),
        statusLabel,
        localizedHint,
        request.approverFirstName,
        request.declineReason,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase(i18n.language)

      return searchableText.includes(normalizedQuery)
    })
  }, [historyQuery.data, i18n.language, liveQuery, statusFilter, t])

  const hasActiveFilters = liveQuery.trim() !== '' || statusFilter !== 'ALL'

  const deepLinkMissing =
    historyQuery.isSuccess &&
    requestIdParam != null &&
    (requestedId == null ||
      !historyQuery.data.some((request) => request.id === requestedId))

  useEffect(() => {
    if (!historyQuery.isSuccess) {
      return
    }

    const deepLinkedRequest =
      requestedId == null
        ? undefined
        : historyQuery.data.find((request) => request.id === requestedId)

    if (requestIdParam != null && deepLinkedRequest?.id != null) {
      setExpandedRequestId(deepLinkedRequest.id)
      return
    }

    setExpandedRequestId(null)
  }, [historyQuery.data, historyQuery.isSuccess, requestIdParam, requestedId])

  const showSubmitSuccessToast = useCallback(() => {
    showToast(t('dashboard:request.success'))
  }, [showToast, t])

  const openRequestLeave = useCallback(() => {
    setModalOpen(true)
  }, [])

  const setStatusFilter = useCallback(
    (status: MyLeavesStatusFilter) => {
      const next = new URLSearchParams(searchParams)
      if (status === 'ALL') {
        next.delete('status')
      } else {
        next.set('status', status)
      }
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    next.delete('status')
    next.delete('requestId')
    setLiveQuery('')
    setSearchParams(next)
    // Clear Filters lives inside the branch it removes; re-home focus to the
    // still-mounted search input so keyboard/SR users are not dropped to <body>.
    document.getElementById(SEARCH_INPUT_ID)?.focus()
  }, [searchParams, setSearchParams])

  const dismissMissingDeepLink = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('requestId')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const toggleDetails = useCallback(
    (id: number) => {
      const next = new URLSearchParams(searchParams)
      if (expandedRequestId === id) {
        setExpandedRequestId(null)
        next.delete('requestId')
      } else {
        setExpandedRequestId(id)
        next.set('requestId', String(id))
      }
      // A local disclosure toggle is not a navigation — replace so Back does
      // not walk through expand/collapse history entries.
      setSearchParams(next, { replace: true })
    },
    [expandedRequestId, searchParams, setSearchParams],
  )

  const openCancel = useCallback(
    (request: RecentRequestResponse) => {
      const variant = cancelVariantFor(request)
      if (request.id == null || variant == null) {
        return
      }
      setCancelReason('')
      setCancelError(null)
      setCancelTarget({
        requestId: request.id,
        variant,
        leaveTypeName: request.leaveTypeName ?? '',
        dateRange: formatDateRange(
          request.dateFrom ?? '',
          request.dateTo ?? '',
          i18n.language,
        ),
        // The server's own arithmetic. The SPA never derives what a cancellation gives back.
        daysToRestore: request.cancellation?.daysToRestore ?? 0,
        daysForfeited: request.cancellation?.daysForfeited ?? 0,
      })
    },
    [i18n.language],
  )

  const dismissCancel = useCallback(() => {
    setCancelTarget(null)
    setCancelReason('')
    setCancelError(null)
  }, [])

  const confirmCancel = useCallback(
    async (reason: string) => {
      const target = cancelTarget
      if (!target || cancelInFlight.current) {
        return
      }
      cancelInFlight.current = true
      setIsCancelling(true)
      setCancelError(null)
      try {
        if (target.variant === 'REVIEW') {
          await reviewRequestMutation.mutateAsync({
            requestId: target.requestId,
            reason,
          })
          showToast(t('leaves:cancel.successReview'))
        } else {
          await cancelMutation.mutateAsync({ requestId: target.requestId })
          showToast(
            target.variant === 'WITHDRAW'
              ? t('leaves:cancel.successWithdraw')
              : t('leaves:cancel.successCancel', { count: target.daysToRestore }),
          )
        }
        setCancelTarget(null)
        setCancelReason('')
      } catch (error) {
        // The API's problem detail says *why* — a closed balance year, a review already open,
        // a request somebody else decided in the meantime — and is far more useful than a
        // generic retry line, so it is preferred whenever the server sent one.
        setCancelError(
          error instanceof ApiError
            ? error.problem.detail ?? t('leaves:cancel.error')
            : t('leaves:cancel.error'),
        )
      } finally {
        cancelInFlight.current = false
        setIsCancelling(false)
      }
    },
    [cancelMutation, cancelTarget, reviewRequestMutation, showToast, t],
  )

  // The attention callout's request action expands that request in the history
  // below (same URL semantics as a details toggle) instead of navigating — the
  // Dashboard's "View My Leaves" link would have pointed at this very page.
  const viewRequest = useCallback(
    (id: number) => {
      const next = new URLSearchParams(searchParams)
      setExpandedRequestId(id)
      next.set('requestId', String(id))
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  return (
    <div className="page page-wide my-leaves-page" data-testid="my-leaves-page">
      <header className="page-header my-leaves-page-header">
        <div>
          <p className="my-leaves-page-eyebrow">{t('leaves:title')}</p>
          <h1 className="page-title" ref={greetingRef} tabIndex={-1}>
            {t('dashboard:greeting', {
              time: t(`dashboard:${timeGreetingKey()}`),
              name: user ? firstName(user.fullName) : t('dashboard:nameFallback'),
            })}
          </h1>
          <p className="page-sub">{t('dashboard:subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary my-leaves-request-button"
          data-testid="request-leave-btn"
          onClick={openRequestLeave}
        >
          <PlusIcon size={16} /> {t('leaves:actions.requestLeave')}
        </button>
      </header>

      {isOrganizationAdmin && guidedOnboarding
        && onboardingQuery.data.activationStatus !== 'COMMERCIALLY_ACTIVATED' && (
        <aside className="first-use-cue" data-testid="guided-onboarding-cue">
          <div className="first-use-cue-header">
            <div>
              <p className="first-use-eyebrow">{t('onboarding:dashboardCue.eyebrow')}</p>
              <h2 className="first-use-title">{t('onboarding:dashboardCue.title')}</h2>
              <p className="first-use-summary">{t('onboarding:dashboardCue.body')}</p>
            </div>
          </div>
          <div className="first-use-actions">
            <Link className="btn btn-primary" to="/onboarding">
              {t('onboarding:dashboardCue.action')}
            </Link>
          </div>
        </aside>
      )}

      {user && isOrganizationAdmin
        && (onboardingQuery.isError
          || (onboardingQuery.isSuccess && onboardingQuery.data.presentationEnabled === false)) && (
        <FirstUseCue
          user={user}
          onStartRequest={openRequestLeave}
          onDismiss={() => greetingRef.current?.focus()}
        />
      )}

      <div className="my-leaves-attention" data-testid="my-leaves-attention">
        <MyLeavesAttention
          canReviewApprovals={Boolean(
            approvalCapability.data?.canReviewApprovals ?? user?.canReviewApprovals
              ?? (user?.role === 'MANAGER' || user?.role === 'ORGANIZATION_ADMIN'),
          )}
          pendingCount={pendingCount}
          isPendingCountLoading={pendingCountQuery.isPending}
          isPendingCountError={pendingCountQuery.isError}
          requests={historyQuery.data ?? []}
          upcoming={upcomingQuery.data ?? []}
          isRecentLoading={historyQuery.isPending}
          isRecentError={historyQuery.isError}
          language={i18n.language}
          onRequestLeave={openRequestLeave}
          onViewRequest={viewRequest}
          onRetryPendingCount={() => void pendingCountQuery.refetch()}
          onRetryRecent={() => void historyQuery.refetch()}
        />
      </div>

      <section
        className="my-leaves-balances"
        aria-labelledby="my-leaves-balances-title"
        data-testid="my-leaves-balances-region"
      >
        <div className="my-leaves-section-heading">
          <div>
            <p className="my-leaves-eyebrow">{t('dashboard:balances.eyebrow')}</p>
            <h2 id="my-leaves-balances-title" className="my-leaves-section-title">
              {t('dashboard:balances.title')}
            </h2>
          </div>
          <p className="my-leaves-section-summary">
            {t('dashboard:balances.summary')}
          </p>
        </div>

        {balancesQuery.isPending && (
          <LoadingState
            label={t('layout:loading.leaveBalances')}
            variant="skeleton"
            testId="my-leaves-balance-grid-loading"
          >
            <div className="balance-grid">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="dashboard-skeleton-card" />
              ))}
            </div>
          </LoadingState>
        )}

        {balancesQuery.isError && (
          <div className="my-leaves-region-error" data-testid="my-leaves-balances-error">
            <p role="alert">{t('leaves:errors.balances')}</p>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void balancesQuery.refetch()}
            >
              {t('common:actions.retry')}
            </button>
          </div>
        )}

        {balancesQuery.isSuccess && balancesQuery.data.length === 0 && (
          <p className="my-leaves-region-empty">{t('dashboard:balances.empty')}</p>
        )}

        {balancesQuery.isSuccess && balancesQuery.data.length > 0 && (
          <div className="balance-grid" data-testid="my-leaves-balance-grid">
            {balancesQuery.data.map((balance) => (
              <BalanceCard key={balance.leaveTypeId} balance={balance} />
            ))}
          </div>
        )}
      </section>

      {deepLinkMissing ? (
        <div
          className="my-leaves-deep-link-not-found"
          data-testid="my-leaves-request-not-found"
          role="status"
        >
          <div>
            <p className="my-leaves-empty-title">{t('leaves:deepLink.notFoundTitle')}</p>
            <p>{t('leaves:deepLink.notFound')}</p>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={dismissMissingDeepLink}
          >
            {t('leaves:deepLink.viewHistory')}
          </button>
        </div>
      ) : null}

      <div className="panel-with-aside my-leaves-layout">
        <div className="panel-stack">
          <section className="card my-leaves-history" data-testid="my-leaves-history">
            <div className="card-header my-leaves-history-header">
              <h2 id="my-leaves-history-title" className="card-title">
                {t('leaves:history.title')}
              </h2>
              {historyQuery.isSuccess ? (
                <p
                  className="my-leaves-result-count"
                  data-testid="my-leaves-result-count"
                >
                  {t('leaves:filters.results', { count: filteredRequests.length })}
                </p>
              ) : null}
            </div>

            <MyLeavesFilters
              query={liveQuery}
              status={statusFilter}
              resultCount={historyQuery.isSuccess ? filteredRequests.length : null}
              onQueryChange={setLiveQuery}
              onStatusChange={setStatusFilter}
            />

            {historyQuery.isPending && (
              <LoadingState
                label={t('layout:loading.leaveHistory')}
                variant="block"
                testId="my-leaves-history-loading"
              />
            )}

            {historyQuery.isError && (
              <div className="my-leaves-region-error" data-testid="my-leaves-history-error">
                <p role="alert">{t('leaves:errors.history')}</p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void historyQuery.refetch()}
                >
                  {t('common:actions.retry')}
                </button>
              </div>
            )}

            {historyQuery.isSuccess && (
              <MyLeavesHistory
                allRequestsCount={historyQuery.data.length}
                requests={filteredRequests}
                showAuditHistory={isOrganizationAdmin}
                hasActiveFilters={hasActiveFilters}
                workforceGroupName={user?.workforceGroupName}
                focusedRequestId={
                  filteredRequests.some((request) => request.id === expandedRequestId)
                    ? expandedRequestId
                    : null
                }
                expandedRequestId={expandedRequestId}
                onClearFilters={clearFilters}
                onRequestLeave={openRequestLeave}
                onToggleDetails={toggleDetails}
                onCancelRequest={openCancel}
              />
            )}
          </section>
        </div>

        <MyLeavesSupportRail
          outToday={outTodayQuery.data ?? []}
          upcoming={upcomingQuery.data ?? []}
          isOutTodayLoading={outTodayQuery.isPending}
          isUpcomingLoading={upcomingQuery.isPending}
          isOutTodayError={outTodayQuery.isError}
          isUpcomingError={upcomingQuery.isError}
          onRetryOutToday={() => void outTodayQuery.refetch()}
          onRetryUpcoming={() => void upcomingQuery.refetch()}
          latestRequest={historyQuery.data?.[0]}
          isLatestLoading={historyQuery.isPending}
          workforceGroupName={user?.workforceGroupName}
        />
      </div>

      <RequestLeaveModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={showSubmitSuccessToast}
      />

      {cancelTarget ? (
        <CancelLeaveModal
          variant={cancelTarget.variant}
          requestId={cancelTarget.requestId}
          leaveTypeName={cancelTarget.leaveTypeName}
          dateRange={cancelTarget.dateRange}
          daysToRestore={cancelTarget.daysToRestore}
          daysForfeited={cancelTarget.daysForfeited}
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onConfirm={(reason) => {
            void confirmCancel(reason)
          }}
          onDismiss={dismissCancel}
          isSubmitting={isCancelling}
          submitError={cancelError}
        />
      ) : null}
    </div>
  )
}
