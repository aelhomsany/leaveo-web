import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../../components/ui/Modal'
import type { CancelLeaveVariant } from './cancellation'
import './my-leaves.css'

type CancelLeaveModalProps = {
  variant: CancelLeaveVariant
  requestId: number
  leaveTypeName: string
  dateRange: string
  daysToRestore: number
  /** Plan RESTO: carried days that expired since the leave was charged and will not come back. */
  daysForfeited: number
  reason: string
  onReasonChange: (reason: string) => void
  onConfirm: (reason: string) => void
  onDismiss: () => void
  isSubmitting: boolean
  submitError: string | null
}

/**
 * Plan VUELTA Part 5. One dialog, three conversations, chosen by the server's `cancellation.mode`
 * (see `cancelVariantFor`). Only the ADMIN_REVIEW variant asks for a reason, and only that variant
 * refuses to submit without one — the API requires 1–500 characters there and nowhere else.
 *
 * The copy is deliberately asymmetric about restitution: WITHDRAW promises nothing back because
 * nothing was charged, CANCEL names the exact day count the server says returns, and REVIEW
 * promises no outcome at all because an Organization Admin may decline it.
 */
export function CancelLeaveModal({
  variant,
  requestId,
  leaveTypeName,
  dateRange,
  daysToRestore,
  daysForfeited,
  reason,
  onReasonChange,
  onConfirm,
  onDismiss,
  isSubmitting,
  submitError,
}: CancelLeaveModalProps) {
  const { t } = useTranslation(['leaves', 'common'])
  const titleId = useId()
  const contextId = `${titleId}-context`
  const errorId = `${titleId}-error`
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const needsReason = variant === 'REVIEW'
  const confirmEnabled =
    !isSubmitting && (!needsReason || reason.trim().length > 0)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const title =
    variant === 'WITHDRAW'
      ? t('leaves:cancel.withdrawTitle')
      : variant === 'CANCEL'
        ? t('leaves:cancel.approvedTitle')
        : t('leaves:cancel.reviewTitle')
  const body =
    variant === 'WITHDRAW'
      ? t('leaves:cancel.withdrawBody')
      : variant === 'CANCEL'
        ? t('leaves:cancel.approvedBody', { count: daysToRestore })
        : t('leaves:cancel.reviewBody')
  // Only cancelling names forfeited days: withdrawing charged nothing, and a review's outcome is
  // the Organization Admin's to decide.
  const forfeitedBody =
    variant === 'CANCEL' && daysForfeited > 0
      ? t('leaves:cancel.forfeitedBody', { count: daysForfeited })
      : null
  const confirmLabel =
    variant === 'WITHDRAW'
      ? t('leaves:cancel.confirmWithdraw')
      : variant === 'CANCEL'
        ? t('leaves:cancel.confirmCancel')
        : t('leaves:cancel.confirmReview')

  return (
    <Modal
      labelledBy={titleId}
      onClose={onDismiss}
      className="cancel-modal-panel modal-backdrop-accent"
      testId="cancel-leave-modal"
      closeOnBackdrop={false}
    >
      <h2 id={titleId} className="cancel-modal-title">
        {title}
      </h2>
      <p id={contextId} className="cancel-modal-context">
        <span dir="auto">{leaveTypeName}</span>
        {' · '}
        <bdi>{dateRange}</bdi>
      </p>
      <p className="cancel-modal-body" data-testid="cancel-leave-body">
        {body}
        {forfeitedBody ? <> {forfeitedBody}</> : null}
      </p>

      {needsReason ? (
        <>
          <label className="cancel-modal-label" htmlFor={`cancel-reason-${requestId}`}>
            {t('leaves:cancel.reviewLabel')}
          </label>
          <textarea
            ref={textareaRef}
            id={`cancel-reason-${requestId}`}
            className="cancel-modal-textarea"
            data-testid="cancel-reason-input"
            rows={4}
            maxLength={500}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            aria-required="true"
            aria-invalid={submitError != null}
            aria-describedby={submitError ? `${contextId} ${errorId}` : contextId}
          />
        </>
      ) : null}

      {submitError ? (
        <p
          id={errorId}
          className="cancel-modal-error"
          role="alert"
          data-testid="cancel-submit-error"
        >
          {submitError}
        </p>
      ) : null}

      <div className="cancel-modal-actions">
        <button
          type="button"
          className="btn btn-sm"
          data-testid="cancel-dismiss-btn"
          onClick={onDismiss}
          disabled={isSubmitting}
        >
          {t('leaves:cancel.dismiss')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger-outline"
          data-testid="cancel-confirm-btn"
          disabled={!confirmEnabled}
          data-busy={isSubmitting ? 'true' : undefined}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
