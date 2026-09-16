import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import type { PendingCancellationResponse } from '../../api/generated/types'
import { useAuth } from '../../auth/useAuth'
import { LoadingState } from '../../components/ui/LoadingState'
import { Modal } from '../../components/ui/Modal'
import { isolate } from '../../i18n/bidi'
import { LeaveTypeTag } from '../dashboard/LeaveTypeTag'
import { formatDateRange } from '../dashboard/leaveRequestFormatting'
import { useCancellationRequests } from './useCancellationRequests'
import { useDecideCancellation } from './useDecideCancellation'
import './approvals.css'

type DeclineTarget = { requestId: number; employeeName: string }

type DecisionKind = 'approve' | 'decline'

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase()
}

/**
 * The reason pattern from `DeclineModal`, on the cancellation copy. It borrows that component's
 * chrome classes rather than the component itself: a cancellation decline says something quite
 * different ("nothing about the leave changes — the days stay used") from declining a leave
 * request, and threading a second copy set through `DeclineModal` would make both harder to read.
 */
function CancellationDeclineModal({
  requestId,
  employeeName,
  note,
  onNoteChange,
  onConfirm,
  onCancel,
  isSubmitting,
  submitError,
}: {
  requestId: number
  employeeName: string
  note: string
  onNoteChange: (note: string) => void
  onConfirm: (note: string) => void
  onCancel: () => void
  isSubmitting: boolean
  submitError: string | null
}) {
  const { t } = useTranslation(['approvals', 'common'])
  const titleId = useId()
  const errorId = `${titleId}-error`
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const confirmEnabled = note.trim().length > 0 && !isSubmitting

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <Modal
      labelledBy={titleId}
      onClose={onCancel}
      className="decline-modal-panel modal-backdrop-accent"
      testId="cancellation-decline-modal"
      closeOnBackdrop={false}
    >
      <h2 id={titleId} className="decline-modal-title">
        {t('approvals:cancellations.declineTitle', { name: isolate(employeeName) })}
      </h2>
      <p className="decline-modal-sub">
        {t('approvals:cancellations.declineSubtitle')}
      </p>
      <label
        className="decline-modal-label"
        htmlFor={`cancellation-decline-note-${requestId}`}
      >
        {t('approvals:cancellations.declineLabel')}
      </label>
      <textarea
        ref={textareaRef}
        id={`cancellation-decline-note-${requestId}`}
        className="decline-modal-textarea"
        data-testid="cancellation-decline-note-input"
        rows={4}
        maxLength={500}
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        aria-required="true"
        aria-invalid={submitError != null}
        aria-describedby={submitError ? errorId : undefined}
      />
      {submitError ? (
        <p
          id={errorId}
          className="decline-modal-error"
          role="alert"
          data-testid="cancellation-decline-error"
        >
          {submitError}
        </p>
      ) : null}
      <div className="decline-modal-actions">
        <button
          type="button"
          className="btn btn-sm"
          data-testid="cancellation-decline-cancel-btn"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {t('common:actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger-outline"
          data-testid="cancellation-decline-confirm-btn"
          disabled={!confirmEnabled}
          data-busy={isSubmitting ? 'true' : undefined}
          onClick={() => onConfirm(note.trim())}
        >
          {t('approvals:cancellations.confirmDecline')}
        </button>
      </div>
    </Modal>
  )
}

function CancellationCard({
  cancellation,
  headingRef,
  inFlightKind,
  onApprove,
  onDecline,
}: {
  cancellation: PendingCancellationResponse
  headingRef: (element: HTMLHeadingElement | null) => void
  inFlightKind: DecisionKind | undefined
  onApprove: () => void
  onDecline: () => void
}) {
  const { t, i18n } = useTranslation(['approvals', 'common'])
  const requestId = cancellation.leaveRequestId ?? 0
  const employeeName = cancellation.employeeFullName?.trim() || t('common:unknown')
  const dateRange = formatDateRange(
    cancellation.dateFrom ?? '',
    cancellation.dateTo ?? '',
    i18n.language,
  )
  const busy = inFlightKind != null
  const requestedAt = cancellation.requestedAt
    ? new Date(cancellation.requestedAt)
    : null
  const requestedLabel =
    requestedAt && !Number.isNaN(requestedAt.getTime())
      ? requestedAt.toLocaleDateString(i18n.language, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null

  return (
    <article
      className="approval-card approval-card--cancellation"
      data-testid={`cancellation-card-${requestId}`}
    >
      <div className="approval-card-header">
        <div className="approval-card-identity">
          <div className="approval-card-person">
            <span className="approval-card-avatar" aria-hidden="true">{initials(employeeName)}</span>
            <div>
              <p className="approval-card-eyebrow">
                {t('approvals:cancellations.eyebrow')}
              </p>
              <h3
                className="approval-card-title"
                data-testid={`cancellation-card-heading-${requestId}`}
                ref={headingRef}
                tabIndex={-1}
                dir="auto"
              >
                {employeeName}
              </h3>
              <div className="approval-card-leave-type">
                <LeaveTypeTag
                  icon={cancellation.leaveTypeIcon ?? ''}
                  name={cancellation.leaveTypeName ?? ''}
                  color={cancellation.leaveTypeColor ?? 'inherit'}
                  backgroundColor="transparent"
                  borderColor="transparent"
                />
              </div>
            </div>
          </div>
        </div>
        {requestedLabel ? (
          <div className="approval-card-policy">
            <span className="approval-weekend-rule">
              {t('approvals:cancellations.requestedAt', {
                date: isolate(requestedLabel),
              })}
            </span>
          </div>
        ) : null}
      </div>

      <div className="approval-card-facts">
        <div>
          <span>{t('approvals:context.dates')}</span>
          <strong>
            <bdi>{dateRange}</bdi>
          </strong>
        </div>
        <div>
          <span>{t('approvals:table.days')}</span>
          <strong>
            {t('approvals:table.workingDays', {
              count: cancellation.workingDays ?? 0,
            })}
          </strong>
        </div>
      </div>

      {/* The consequence of approving, in the server's own numbers — days and balance year both
          come from the cancellation row, never from arithmetic done here. */}
      <p className="approval-card-step" data-testid={`cancellation-consequence-${requestId}`}>
        {t('approvals:cancellations.consequence', {
          count: cancellation.daysToRestore ?? 0,
          year: isolate(cancellation.balanceYear ?? 0),
        })}
        {(cancellation.carryoverDaysToRestore ?? 0) > 0
          ? ` ${t('approvals:cancellations.consequenceCarryover', {
              count: cancellation.carryoverDaysToRestore ?? 0,
            })}`
          : null}
        {(cancellation.daysForfeited ?? 0) > 0
          ? ` ${t('approvals:cancellations.consequenceForfeited', {
              count: cancellation.daysForfeited ?? 0,
            })}`
          : null}
      </p>

      {cancellation.reason ? (
        <blockquote className="approval-card-note">
          <span>{t('approvals:cancellations.reasonLabel')}</span>
          <p dir="auto">{cancellation.reason}</p>
        </blockquote>
      ) : null}

      <div className="approval-actions">
        <button
          type="button"
          className="btn btn-danger-outline"
          data-testid={`cancellation-decline-btn-${requestId}`}
          onClick={onDecline}
          disabled={busy}
          data-busy={inFlightKind === 'decline' ? 'true' : undefined}
          aria-label={t('approvals:cancellations.ariaDecline', { name: employeeName })}
        >
          {t('approvals:cancellations.decline')}
        </button>
        <button
          type="button"
          className="btn btn-success"
          data-testid={`cancellation-approve-btn-${requestId}`}
          onClick={onApprove}
          disabled={busy}
          data-busy={inFlightKind === 'approve' ? 'true' : undefined}
          aria-label={t('approvals:cancellations.ariaApprove', { name: employeeName })}
        >
          {t('approvals:cancellations.approve')}
        </button>
      </div>
    </article>
  )
}

/**
 * Plan VUELTA Part 5 — the Organization Admin's cancellation queue, above the leave queue on the
 * Approvals page. It renders nothing at all for every other role (CANCEL-UI-VAL-006): managers do
 * not review cancellations, and the API answers them 403 on both decisions.
 */
export function CancellationRequestsSection() {
  const { t } = useTranslation(['approvals', 'layout', 'common'])
  const { user } = useAuth()
  const isOrganizationAdmin = user?.role === 'ORGANIZATION_ADMIN'
  const query = useCancellationRequests(isOrganizationAdmin)
  const { approve, decline } = useDecideCancellation()
  const [declineTarget, setDeclineTarget] = useState<DeclineTarget | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [decidedRequestIds, setDecidedRequestIds] = useState<Set<number>>(
    () => new Set(),
  )
  const [feedback, setFeedback] = useState<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<number | 'empty' | null>(null)
  const headingRefs = useRef(new Map<number, HTMLHeadingElement>())
  const emptyRef = useRef<HTMLParagraphElement>(null)
  // Same reason the leave queue owns its own map: React Query's `isPending` is per-observer and
  // stalls under StrictMode, and these two mutations are shared instances whose `variables` are
  // re-pointed by the next call. The ref is the authority for the re-entrancy guard; the state
  // copy exists only to re-render (CANCEL-UI-VAL-007).
  const inFlightRef = useRef(new Map<number, DecisionKind>())
  const [inFlight, setInFlight] = useState<ReadonlyMap<number, DecisionKind>>(
    () => new Map(),
  )

  const pending = useMemo(
    () =>
      (query.data ?? []).filter(
        (row) => row.leaveRequestId != null && !decidedRequestIds.has(row.leaveRequestId),
      ),
    [query.data, decidedRequestIds],
  )

  // Keep the decided set bounded: drop ids the refetched queue no longer carries.
  useEffect(() => {
    const present = new Set(
      (query.data ?? [])
        .map((row) => row.leaveRequestId)
        .filter((id): id is number => id != null),
    )
    setDecidedRequestIds((current) => {
      const next = new Set([...current].filter((id) => present.has(id)))
      return next.size === current.size ? current : next
    })
  }, [query.data])

  useEffect(() => {
    if (focusTarget == null) {
      return
    }
    const target =
      focusTarget === 'empty'
        ? emptyRef.current
        : headingRefs.current.get(focusTarget) ?? emptyRef.current
    target?.focus()
    setFocusTarget(null)
  }, [focusTarget])

  if (!isOrganizationAdmin) {
    return null
  }

  const beginDecision = (requestId: number, kind: DecisionKind): boolean => {
    if (inFlightRef.current.has(requestId)) {
      return false
    }
    inFlightRef.current.set(requestId, kind)
    setInFlight(new Map(inFlightRef.current))
    return true
  }

  // Always from a `finally` — releasing only on success would strand a card permanently disabled
  // after a failed decision.
  const endDecision = (requestId: number) => {
    inFlightRef.current.delete(requestId)
    setInFlight(new Map(inFlightRef.current))
  }

  const resolveError = (error: unknown, fallback: string): string =>
    error instanceof ApiError ? error.problem.detail ?? fallback : fallback

  const finishDecision = (requestId: number, message: string) => {
    const currentIndex = pending.findIndex((row) => row.leaveRequestId === requestId)
    const remaining = pending.filter((row) => row.leaveRequestId !== requestId)
    const next = remaining[currentIndex] ?? remaining[0]
    setDecidedRequestIds((current) => new Set(current).add(requestId))
    setFeedback(message)
    setFocusTarget(next?.leaveRequestId ?? 'empty')
  }

  const handleApprove = async (requestId: number, employeeName: string) => {
    if (!beginDecision(requestId, 'approve')) {
      return
    }
    setFeedback(null)
    try {
      await approve.mutateAsync({ requestId })
      finishDecision(
        requestId,
        t('approvals:cancellations.successApproved', { name: employeeName }),
      )
    } catch (error) {
      setFeedback(resolveError(error, t('approvals:cancellations.errorApprove')))
    } finally {
      endDecision(requestId)
    }
  }

  const handleDeclineConfirm = async (note: string) => {
    const target = declineTarget
    if (!target) {
      return
    }
    setDeclineError(null)
    if (!beginDecision(target.requestId, 'decline')) {
      return
    }
    try {
      await decline.mutateAsync({ requestId: target.requestId, note })
      setDeclineTarget(null)
      setDeclineNote('')
      finishDecision(
        target.requestId,
        t('approvals:cancellations.successDeclined', { name: target.employeeName }),
      )
    } catch (error) {
      setDeclineError(
        resolveError(error, t('approvals:cancellations.errorDecline')),
      )
    } finally {
      endDecision(target.requestId)
    }
  }

  return (
    <section
      className="approvals-queue approvals-cancellations"
      aria-labelledby="approvals-cancellations-title"
      data-testid="approvals-cancellations"
    >
      <div className="approvals-section-heading">
        <div>
          <p className="approvals-section-eyebrow">
            {t('approvals:cancellations.eyebrow')}
          </p>
          <h2 id="approvals-cancellations-title">
            {t('approvals:cancellations.title')}
          </h2>
        </div>
        <p>{t('approvals:cancellations.description')}</p>
      </div>

      {feedback ? (
        <div
          className="approvals-feedback approvals-feedback--status"
          data-testid="cancellation-decision-feedback"
          role="status"
        >
          {feedback}
        </div>
      ) : null}

      {query.isPending ? (
        <LoadingState
          label={t('layout:loading.pendingCancellations')}
          testId="cancellations-loading"
        />
      ) : query.isError ? (
        <div
          className="approvals-error-state"
          data-testid="cancellations-error-state"
          role="alert"
        >
          <p>{t('approvals:cancellations.error')}</p>
        </div>
      ) : pending.length === 0 ? (
        <div
          className="approvals-empty-state"
          data-testid="cancellations-empty-state"
          role="status"
        >
          <p ref={emptyRef} tabIndex={-1}>
            {t('approvals:cancellations.empty')}
          </p>
        </div>
      ) : (
        <div className="approvals-card-list" data-testid="cancellations-list">
          {pending.map((cancellation) => {
            const requestId = cancellation.leaveRequestId!
            const employeeName =
              cancellation.employeeFullName?.trim() || t('common:unknown')
            return (
              <CancellationCard
                key={requestId}
                cancellation={cancellation}
                headingRef={(element) => {
                  if (element) {
                    headingRefs.current.set(requestId, element)
                  } else {
                    headingRefs.current.delete(requestId)
                  }
                }}
                inFlightKind={inFlight.get(requestId)}
                onApprove={() => {
                  void handleApprove(requestId, employeeName)
                }}
                onDecline={() => {
                  setDeclineNote('')
                  setDeclineError(null)
                  setDeclineTarget({ requestId, employeeName })
                }}
              />
            )
          })}
        </div>
      )}

      {declineTarget ? (
        <CancellationDeclineModal
          requestId={declineTarget.requestId}
          employeeName={declineTarget.employeeName}
          note={declineNote}
          onNoteChange={setDeclineNote}
          onConfirm={(note) => {
            void handleDeclineConfirm(note)
          }}
          onCancel={() => {
            setDeclineTarget(null)
            setDeclineNote('')
            setDeclineError(null)
          }}
          isSubmitting={inFlight.get(declineTarget.requestId) === 'decline'}
          submitError={declineError}
        />
      ) : null}
    </section>
  )
}
