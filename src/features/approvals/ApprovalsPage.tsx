import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/useAuth'
import { CoverageSummary } from '../../components/ui/CoverageSummary'
import { HorizontalScrollRegion } from '../../components/ui/HorizontalScrollRegion'
import { LoadingState } from '../../components/ui/LoadingState'
import { CheckCircleIcon } from '../../components/ui/icons'
import { useDashboardOutToday } from '../dashboard/useDashboardOutToday'
import { useDashboardUpcoming } from '../dashboard/useDashboardUpcoming'
import { formatDateRange } from '../dashboard/leaveRequestFormatting'
import { ApprovalCard } from './ApprovalCard'
import { CancellationRequestsSection } from './CancellationRequestsSection'
import { DeclineModal } from './DeclineModal'
import { ConcernModal } from './ConcernModal'
import { RecentDecisionRow } from './RecentDecisionRow'
import { useApproveRequest } from './useApproveRequest'
import { useDeclineRequest } from './useDeclineRequest'
import { usePendingApprovals } from './usePendingApprovals'
import { useRecentApprovalDecisions } from './useRecentApprovalDecisions'
import { useRecordApprovalConcern } from './useRecordApprovalConcern'
import './approvals.css'

type DeclineTarget = {
  requestId: number
  approvalLevel: number
  employeeUserId: number
  employeeName: string
  dateRange: string
}

type DecisionFeedback = {
  tone: 'status' | 'alert'
  message: string
}

type ConcernTarget = { requestId: number; approvalLevel: number; employeeName: string }

type ApprovalKey = `${number}:${number}`

type DecisionKind = 'approve' | 'decline' | 'concern'

function approvalKey(requestId: number, approvalLevel: number): ApprovalKey {
  return `${requestId}:${approvalLevel}`
}

export function ApprovalsPage() {
  const { t, i18n } = useTranslation(['approvals', 'layout', 'common'])
  const { user } = useAuth()
  const { data: pendingApprovals = [], isPending, isError } = usePendingApprovals()
  const {
    data: recentDecisions = [],
    isPending: isRecentPending,
    isError: isRecentError,
  } = useRecentApprovalDecisions()
  const approveMutation = useApproveRequest()
  const declineMutation = useDeclineRequest()
  const concernMutation = useRecordApprovalConcern()
  const outTodayQuery = useDashboardOutToday()
  const upcomingQuery = useDashboardUpcoming()
  const [declineTarget, setDeclineTarget] = useState<DeclineTarget | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [declineSubmitError, setDeclineSubmitError] = useState<string | null>(null)
  const [concernTarget, setConcernTarget] = useState<ConcernTarget | null>(null)
  const [concernNote, setConcernNote] = useState('')
  const [concernError, setConcernError] = useState<string | null>(null)
  const [removedApprovalKeys, setRemovedApprovalKeys] = useState<Set<ApprovalKey>>(
    () => new Set(),
  )
  const [staleApprovalKeys, setStaleApprovalKeys] = useState<Set<ApprovalKey>>(
    () => new Set(),
  )
  // Busy state is keyed by (requestId, approvalLevel) — the same key the removed/stale
  // sets above use — because the three decision mutations are shared instances whose
  // `variables` are re-pointed by the next call. Deriving busy state from those shared
  // variables re-enabled an in-flight card as soon as a second decision started, which
  // defeated the AC6 duplicate-submit guarantee. The ref is the authority for the
  // re-entrancy guard so two clicks in one tick cannot both pass it; the state copy
  // exists only to re-render.
  const inFlightRef = useRef(new Map<ApprovalKey, DecisionKind>())
  const [inFlightDecisions, setInFlightDecisions] = useState<
    ReadonlyMap<ApprovalKey, DecisionKind>
  >(() => new Map())
  const [decisionFeedback, setDecisionFeedback] =
    useState<DecisionFeedback | null>(null)
  const [focusTarget, setFocusTarget] = useState<ApprovalKey | 'empty' | null>(null)
  const headingRefs = useRef(new Map<ApprovalKey, HTMLHeadingElement>())
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null)
  const isOrganizationAdmin = user?.role === 'ORGANIZATION_ADMIN'
  const subtitle = isOrganizationAdmin
    ? t('approvals:subtitle.organizationAdmin')
    : t('approvals:subtitle.manager')

  const visibleApprovals = useMemo(
    () =>
      pendingApprovals.filter(
        (approval) =>
          approval.requestId != null && !removedApprovalKeys.has(approvalKey(
            approval.requestId,
            approval.approvalLevel ?? 1,
          )),
      ),
    [pendingApprovals, removedApprovalKeys],
  )
  const offToday = (outTodayQuery.data ?? []).filter(
    (row) => row.presence === 'OFF',
  ).length
  const workingFromHomeToday = (outTodayQuery.data ?? []).filter(
    (row) => row.presence === 'WFH',
  ).length
  const coverageIsLoading = outTodayQuery.isPending || upcomingQuery.isPending
  const coverageIsPartial = outTodayQuery.isError || upcomingQuery.isError
  const outTodayOk = !outTodayQuery.isPending && !outTodayQuery.isError
  const upcomingOk = !upcomingQuery.isPending && !upcomingQuery.isError
  const oldestSubmittedAt = visibleApprovals
    .map((approval) => approval.submittedAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0]

  useEffect(() => {
    if (focusTarget == null) {
      return
    }
    let target: HTMLHeadingElement | null | undefined
    if (focusTarget === 'empty') {
      target = emptyHeadingRef.current
    } else {
      target = headingRefs.current.get(focusTarget)
      if (!target) {
        // The computed next card was removed by a refetch before focus landed;
        // fall back to the first remaining card heading, then the empty-state
        // heading, so keyboard/SR focus is never dropped to <body>.
        const firstRemaining = visibleApprovals[0]
        target =
          (firstRemaining?.requestId != null
            ? headingRefs.current.get(approvalKey(
                firstRemaining.requestId,
                firstRemaining.approvalLevel ?? 1,
              ))
            : null) ?? emptyHeadingRef.current
      }
    }
    target?.focus()
    setFocusTarget(null)
  }, [focusTarget, visibleApprovals])

  // Keep the removed/stale id sets bounded: drop ids no longer present in the
  // refetched pending list so they cannot accumulate across a long session.
  useEffect(() => {
    const presentKeys = new Set<ApprovalKey>(
      pendingApprovals
        .filter((approval) => approval.requestId != null)
        .map((approval) => approvalKey(
          approval.requestId!,
          approval.approvalLevel ?? 1,
        )),
    )
    const prune = (current: Set<ApprovalKey>): Set<ApprovalKey> => {
      const next = new Set([...current].filter((key) => presentKeys.has(key)))
      return next.size === current.size ? current : next
    }
    setRemovedApprovalKeys((current) => prune(current))
    setStaleApprovalKeys((current) => prune(current))
  }, [pendingApprovals])

  // Returns false when a decision for this key is already in flight, so every handler
  // can refuse a duplicate submit with a single guard.
  const beginDecision = (key: ApprovalKey, kind: DecisionKind): boolean => {
    if (inFlightRef.current.has(key)) {
      return false
    }
    inFlightRef.current.set(key, kind)
    setInFlightDecisions(new Map(inFlightRef.current))
    return true
  }

  // Always called from a `finally` — releasing only on success would strand a card
  // permanently disabled after a failed decision.
  const endDecision = (key: ApprovalKey) => {
    inFlightRef.current.delete(key)
    setInFlightDecisions(new Map(inFlightRef.current))
  }

  const resolveMutationError = (error: unknown, fallback: string): string => {
    if (error instanceof ApiError) {
      return error.problem.detail ?? fallback
    }
    return fallback
  }

  const formatSubmittedDate = (submittedAt: string): string => {
    const date = new Date(submittedAt)
    if (Number.isNaN(date.getTime())) {
      return submittedAt
    }
    return date.toLocaleDateString(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const finishDecision = (requestId: number, approvalLevel: number, message: string) => {
    const completedKey = approvalKey(requestId, approvalLevel)
    const currentIndex = visibleApprovals.findIndex(
      (approval) => approval.requestId === requestId
        && (approval.approvalLevel ?? 1) === approvalLevel,
    )
    const remaining = visibleApprovals.filter(
      (approval) => approval.requestId !== requestId
        || (approval.approvalLevel ?? 1) !== approvalLevel,
    )
    const nextApproval = remaining[currentIndex] ?? remaining[0]

    setRemovedApprovalKeys((current) => new Set(current).add(completedKey))
    setDecisionFeedback({ tone: 'status', message })
    setFocusTarget(nextApproval?.requestId == null ? 'empty' : approvalKey(
      nextApproval.requestId,
      nextApproval.approvalLevel ?? 1,
    ))
  }

  const markStale = (requestId: number, approvalLevel: number, employeeName: string) => {
    setStaleApprovalKeys((current) => new Set(current).add(
      approvalKey(requestId, approvalLevel),
    ))
    setDecisionFeedback({
      tone: 'alert',
      message: t('approvals:stale.announcement', { name: employeeName }),
    })
  }

  // Each handler awaits its own mutation promise rather than the shared mutation
  // observer's per-call callbacks: starting a second decision re-points that observer,
  // so the first decision's callbacks would never fire and its key would never be
  // released. `mutateAsync` still runs the hook-level onSuccess invalidations.
  const handleApprove = async (
    requestId: number,
    employeeUserId: number,
    employeeName: string,
    approvalLevel: number,
  ) => {
    const key = approvalKey(requestId, approvalLevel)
    if (!beginDecision(key, 'approve')) {
      return
    }
    setDecisionFeedback(null)
    try {
      await approveMutation.mutateAsync({ requestId, employeeUserId, approvalLevel })
      finishDecision(
        requestId,
        approvalLevel,
        t('approvals:success.approved', { name: employeeName }),
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        markStale(requestId, approvalLevel, employeeName)
      } else {
        setDecisionFeedback({
          tone: 'alert',
          message: resolveMutationError(error, t('approvals:errors.approve')),
        })
      }
    } finally {
      endDecision(key)
    }
  }

  const handleDeclineConfirm = async (reason: string) => {
    const target = declineTarget
    if (!target) {
      return
    }
    const key = approvalKey(target.requestId, target.approvalLevel)
    // Clear before the guard: a refused duplicate must not leave a stale error on screen
    // with no other feedback that the press was received.
    setDeclineSubmitError(null)
    setDecisionFeedback(null)
    if (!beginDecision(key, 'decline')) {
      return
    }
    try {
      await declineMutation.mutateAsync({
        requestId: target.requestId,
        employeeUserId: target.employeeUserId,
        approvalLevel: target.approvalLevel,
        reason,
      })
      setDeclineTarget(null)
      setDeclineReason('')
      setDeclineSubmitError(null)
      finishDecision(
        target.requestId,
        target.approvalLevel,
        t('approvals:success.declined', { name: target.employeeName }),
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        markStale(target.requestId, target.approvalLevel, target.employeeName)
        setDeclineSubmitError(
          t('approvals:stale.modal', { name: target.employeeName }),
        )
      } else {
        setDeclineSubmitError(
          resolveMutationError(error, t('approvals:errors.decline')),
        )
      }
    } finally {
      endDecision(key)
    }
  }

  const handleConcernConfirm = async (note: string) => {
    const target = concernTarget
    if (!target) {
      return
    }
    const key = approvalKey(target.requestId, target.approvalLevel)
    setConcernError(null)
    if (!beginDecision(key, 'concern')) {
      return
    }
    try {
      await concernMutation.mutateAsync({
        requestId: target.requestId,
        approvalLevel: target.approvalLevel,
        note,
      })
      setConcernTarget(null)
      setConcernNote('')
      finishDecision(
        target.requestId,
        target.approvalLevel,
        t('approvals:success.concern', { name: target.employeeName }),
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        markStale(target.requestId, target.approvalLevel, target.employeeName)
      }
      setConcernError(resolveMutationError(error, t('approvals:errors.concern')))
    } finally {
      endDecision(key)
    }
  }

  return (
    <div className="page page-wide approvals-page" data-testid="approvals-page">
      <header className="page-header approvals-page-header">
        <div>
          <p className="approvals-page-eyebrow">{t('approvals:hero.eyebrow')}</p>
          <h1 className="page-title">{t('approvals:title')}</h1>
          <p className="page-sub">{subtitle}</p>
        </div>
      </header>

      <section
        className="approvals-summary"
        aria-label={t('approvals:summary.label')}
        data-testid="approvals-summary"
      >
        <dl>
          <div className="approvals-summary-card approvals-summary-card--priority">
            <dt>{t('approvals:summary.pendingLabel')}</dt>
            <dd>{visibleApprovals.length}</dd>
          </div>
          {oldestSubmittedAt ? (
            <div className="approvals-summary-card">
              <dt>{t('approvals:summary.oldestLabel')}</dt>
              <dd>
                <bdi>{formatSubmittedDate(oldestSubmittedAt)}</bdi>
              </dd>
            </div>
          ) : null}
          {!coverageIsLoading ? (
            <div className="approvals-summary-card">
              <dt>{t('approvals:summary.coverageLabel')}</dt>
              <dd>
                {outTodayOk && upcomingOk
                  ? t('approvals:summary.coverageFacts', {
                      off: offToday,
                      upcoming: upcomingQuery.data?.length ?? 0,
                    })
                  : outTodayOk
                    ? t('approvals:summary.coverageOffOnly', { off: offToday })
                    : t('approvals:summary.coveragePartial')}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {decisionFeedback ? (
        <div
          className={`approvals-feedback approvals-feedback--${decisionFeedback.tone}`}
          data-testid="approvals-decision-feedback"
          role={decisionFeedback.tone}
        >
          {decisionFeedback.message}
        </div>
      ) : null}

      {/* Plan VUELTA: retroactive cancellations sit above the leave queue — they are the older
          debt, and the section renders nothing at all for non-admins. */}
      <CancellationRequestsSection />

      <div className="panel-with-aside">
        <section className="approvals-queue" aria-labelledby="approvals-queue-title">
          <div className="approvals-section-heading">
            <div>
              <p className="approvals-section-eyebrow">
                {t('approvals:queue.eyebrow')}
              </p>
              <h2 id="approvals-queue-title">{t('approvals:queue.title')}</h2>
            </div>
            <p>{t('approvals:queue.description')}</p>
          </div>

          {isPending ? (
            <LoadingState
              label={t('layout:loading.pendingApprovals')}
              testId="approvals-pending-loading"
            />
          ) : isError ? (
            <div
              className="approvals-error-state"
              data-testid="approvals-error-state"
              role="alert"
            >
              <p>{t('approvals:errors.pending')}</p>
            </div>
          ) : visibleApprovals.length === 0 ? (
            <div
              className="approvals-empty-state"
              data-testid="approvals-empty-state"
              role="status"
            >
              <div aria-hidden="true" className="approvals-empty-icon">
                <CheckCircleIcon size={40} />
              </div>
              <h3
                ref={emptyHeadingRef}
                tabIndex={-1}
                data-testid="approvals-all-caught-up-heading"
              >
                {t('approvals:empty')}
              </h3>
              <p>{t('approvals:emptyDescription')}</p>
            </div>
          ) : (
            <div className="approvals-card-list" data-testid="approvals-pending-list">
              {visibleApprovals.map((approval) => {
                const requestId = approval.requestId!
                const approvalLevel = approval.approvalLevel ?? 1
                const itemKey = approvalKey(requestId, approvalLevel)
                const employeeUserId = approval.employeeUserId ?? 0
                const employeeName =
                  approval.employeeFullName?.trim() || t('common:unknown')
                const dateRange = formatDateRange(
                  approval.dateFrom ?? '',
                  approval.dateTo ?? '',
                  i18n.language,
                )
                const inFlightKind = inFlightDecisions.get(itemKey)

                return (
                  <ApprovalCard
                    key={itemKey}
                    approval={approval}
                    coverage={{
                      // Server read-model fact: approved absences overlapping this
                      // request's window, including absences already underway.
                      overlappingAbsences: approval.overlappingApprovedAbsences,
                    }}
                    headingRef={(element) => {
                      if (element) {
                        headingRefs.current.set(itemKey, element)
                      } else {
                        headingRefs.current.delete(itemKey)
                      }
                    }}
                    isApproving={inFlightKind === 'approve'}
                    isDeclining={inFlightKind === 'decline'}
                    isRecordingConcern={inFlightKind === 'concern'}
                    isStale={staleApprovalKeys.has(itemKey)}
                    onApprove={() => {
                      void handleApprove(
                        requestId,
                        employeeUserId,
                        employeeName,
                        approvalLevel,
                      )
                    }}
                    onDecline={() => {
                      setDeclineReason('')
                      setDeclineSubmitError(null)
                      setDeclineTarget({
                        requestId,
                        approvalLevel,
                        employeeUserId,
                        employeeName,
                        dateRange,
                      })
                    }}
                    onConcern={() => {
                      setConcernNote('')
                      setConcernError(null)
                      setConcernTarget({ requestId, approvalLevel, employeeName })
                    }}
                  />
                )
              })}
            </div>
          )}
        </section>

        {/* The shared rail, not a fork of it. The feature's own `.approvals-coverage-rail`
            was `display: none` below ~1204px, so a manager on a laptop lost the coverage
            figures entirely rather than reading them stacked. `.support-rail` reflows into
            the reading column at 1200px and keeps every fact on screen. */}
        <aside className="support-rail" aria-labelledby="approvals-coverage-title">
          <div className="support-note" data-testid="approvals-coverage-note">
            <h2 className="support-note-title" id="approvals-coverage-title">
              {t('approvals:coverage.teamTitle')}
            </h2>
            <p className="support-note-body">
              {t('approvals:coverage.railDescription')}
            </p>
            <CoverageSummary
              label={t('approvals:coverage.summaryLabel')}
              offToday={offToday}
              workingFromHomeToday={workingFromHomeToday}
              upcoming={upcomingQuery.data?.length ?? 0}
              offLabel={t('approvals:coverage.offToday')}
              workingFromHomeLabel={t('approvals:coverage.wfhToday')}
              upcomingLabel={t('approvals:coverage.upcoming')}
              stateLabel={t('approvals:coverage.state', { count: offToday })}
              isLoading={coverageIsLoading}
              loadingLabel={t('approvals:coverage.loading')}
              isPartial={coverageIsPartial}
              partialLabel={t('approvals:coverage.partialRail')}
            />
          </div>
          <div className="support-note" data-testid="approvals-decision-note">
            <p className="support-note-title">
              {t('approvals:coverage.advisoryTitle')}
            </p>
            <p className="support-note-body">
              {t('approvals:coverage.advisory')}
            </p>
          </div>
        </aside>
      </div>

      <section
        className="recent-decisions-section"
        data-testid="approvals-recent-decisions"
      >
        <div className="approvals-section-heading approvals-section-heading--recent">
          <div>
            <p className="approvals-section-eyebrow">
              {t('approvals:recent.eyebrow')}
            </p>
            <h2 id="recent-decisions-title" className="recent-decisions-title">
              {t('approvals:recent.title')}
            </h2>
          </div>
          <p>{t('approvals:recent.description')}</p>
        </div>

        {/* A band, not a rail: the decisions table has a min-content width of 1077.6px
            against a 1121px panel, so a 300px rail beside it would leave the reading
            column narrower than the table can draw and push it into a sideways scroll. */}
        <div className="support-band support-band-spaced" data-testid="approvals-recent-band">
          <div className="support-note">
            <p className="support-note-title">{t('approvals:recent.shownTitle')}</p>
            <dl className="support-note-list">
              <div className="support-note-kv">
                <dt>{t('approvals:recent.shownLabel')}</dt>
                <dd data-testid="approvals-recent-shown">
                  {isRecentPending || isRecentError ? '—' : recentDecisions.length}
                </dd>
              </div>
            </dl>
            <p className="support-note-body support-note-footnote">
              {t('approvals:recent.shownFootnote')}
            </p>
          </div>
          <div className="support-note">
            <p className="support-note-title">{t('approvals:recent.readingTitle')}</p>
            <ul className="support-note-bullets">
              <li>{t('approvals:recent.readingDays')}</li>
              <li>{t('approvals:recent.readingEvidence')}</li>
            </ul>
          </div>
        </div>

        {isRecentPending ? (
          <LoadingState
            label={t('layout:loading.recentDecisions')}
            testId="approvals-recent-loading"
          />
        ) : isRecentError ? (
          <div
            className="approvals-error-state"
            data-testid="recent-decisions-error"
            role="alert"
          >
            <p>{t('approvals:errors.recent')}</p>
          </div>
        ) : recentDecisions.length === 0 ? (
          <div
            className="recent-decisions-empty"
            data-testid="recent-decisions-empty"
            role="status"
          >
            <p>{t('approvals:recent.empty')}</p>
          </div>
        ) : (
          <HorizontalScrollRegion
            className="card table-wrap"
            testId="recent-decisions-table"
            labelledBy="recent-decisions-title"
            describedById="recent-decisions-scroll-hint"
          >
            <table className="recent-decisions-table">
              <caption className="sr-only">
                {t('approvals:recent.caption')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('approvals:table.employee')}</th>
                  <th scope="col">{t('approvals:table.leaveType')}</th>
                  <th scope="col">{t('approvals:table.dates')}</th>
                  <th scope="col">{t('approvals:table.days')}</th>
                  <th scope="col">{t('approvals:table.status')}</th>
                  <th scope="col">{t('approvals:table.decidedBy')}</th>
                  <th scope="col">{t('approvals:table.decisionDate')}</th>
                  {isOrganizationAdmin ? (
                    <th scope="col">{t('approvals:table.audit')}</th>
                  ) : null}
                  <th scope="col">{t('approvals:table.approvalEvidence')}</th>
                </tr>
              </thead>
              <tbody>
                {recentDecisions.map((decision) => {
                  if (decision.requestId == null) {
                    return null
                  }
                  return (
                    <RecentDecisionRow
                      key={decision.requestId}
                      decision={decision}
                      showAuditHistory={isOrganizationAdmin}
                    />
                  )
                })}
              </tbody>
            </table>
          </HorizontalScrollRegion>
        )}
      </section>

      {declineTarget ? (
        <DeclineModal
          requestId={declineTarget.requestId}
          employeeName={declineTarget.employeeName}
          dateRange={declineTarget.dateRange}
          reason={declineReason}
          onReasonChange={setDeclineReason}
          onConfirm={(reason) => {
            void handleDeclineConfirm(reason)
          }}
          onCancel={() => {
            setDeclineTarget(null)
            setDeclineReason('')
            setDeclineSubmitError(null)
          }}
          isSubmitting={
            inFlightDecisions.get(
              approvalKey(declineTarget.requestId, declineTarget.approvalLevel),
            ) === 'decline'
          }
          submitError={declineSubmitError}
          isStale={staleApprovalKeys.has(approvalKey(
            declineTarget.requestId,
            declineTarget.approvalLevel,
          ))}
        />
      ) : null}
      {concernTarget ? (
        <ConcernModal
          employeeName={concernTarget.employeeName}
          note={concernNote}
          isSubmitting={
            inFlightDecisions.get(
              approvalKey(concernTarget.requestId, concernTarget.approvalLevel),
            ) === 'concern'
          }
          error={concernError}
          onNoteChange={setConcernNote}
          onConfirm={(note) => {
            void handleConcernConfirm(note)
          }}
          onClose={() => {
            setConcernTarget(null)
            setConcernNote('')
            setConcernError(null)
          }}
        />
      ) : null}
    </div>
  )
}
