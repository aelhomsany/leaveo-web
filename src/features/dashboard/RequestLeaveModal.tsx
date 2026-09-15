import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isolate } from '../../i18n/bidi'
import { ApiError, getLeaveTypes } from '../../api/client'
import { fieldErrorsFromApiError, LEAVE_REQUEST_FIELD_IDS } from '../../api/fieldViolations'
import { DateField } from '../../components/DateField'
import { FieldErrorMessage } from '../../components/form/FieldErrorMessage'
import { Modal } from '../../components/ui/Modal'
import {
  WorkingDayExplainer,
  type WorkingDayExplainerState,
} from '../../components/ui/WorkingDayExplainer'
import { CloseIcon } from '../../components/ui/icons'
import { useAuth } from '../../auth/useAuth'
import { useCreateLeaveRequest } from './useCreateLeaveRequest'
import { formatDate } from './leaveRequestFormatting'
import { useLeaveRequestPreview } from './useLeaveRequestPreview'
import { translateFieldViolation } from '../../i18n/fieldViolationMessage'
import './request-leave.css'

type RequestLeaveModalProps = {
  open: boolean
  onClose: () => void
  /** Story 3.4 — success toast callback from parent */
  onSuccess?: () => void
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

export function RequestLeaveModal({ open, onClose, onSuccess }: RequestLeaveModalProps) {
  const { t, i18n } = useTranslation(['dashboard', 'common'])
  const { user } = useAuth()
  const orgId = user?.organizationId
  const createMutation = useCreateLeaveRequest()
  const resetCreateMutation = createMutation.reset

  const [leaveTypeId, setLeaveTypeId] = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [note, setNote] = useState('')
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const debouncedFrom = useDebouncedValue(dateFrom, 300)
  const debouncedTo = useDebouncedValue(dateTo, 300)

  const leaveTypesQuery = useQuery({
    queryKey: ['leave-types', orgId],
    queryFn: getLeaveTypes,
    enabled: open && orgId != null,
  })

  const previewQuery = useLeaveRequestPreview(
    debouncedFrom,
    debouncedTo,
    leaveTypeId === '' ? undefined : leaveTypeId,
  )

  const clientDateInvalid =
    dateFrom !== '' && dateTo !== '' && dateTo < dateFrom
  // An organization is provisioned with no Workforce Groups; the founding Organization Admin is created
  // ungrouped and is adopted into the first group they create. Until then every working-day
  // calculation for them is a guaranteed 400, so the preview is skipped and the explainer says
  // what to do instead of echoing the server's untranslated "no workforce group assigned".
  // Only that one account can ever be in this state: team members always carry a group, and an
  // update cannot clear one.
  const viewerUngrouped = user != null && user.workforceGroupName == null

  const previewEnabled =
    !viewerUngrouped &&
    user?.id != null &&
    debouncedFrom !== '' &&
    debouncedTo !== '' &&
    debouncedTo >= debouncedFrom

  const preview = previewQuery.data
  const excludedTotal =
    preview != null ? preview.excludedWeekends + preview.excludedHolidays : 0

  // Plan RESTO / D-9: the two refusals a requester can act on are translated by problem type; any
  // other problem keeps the server's own detail.
  const problemMessage = (error: ApiError, fallback: string) => {
    if (error.problem.code === 'leave-spans-balance-years') {
      return t('dashboard:request.errors.spansBalanceYears')
    }
    if (error.problem.type?.endsWith('/insufficient-balance')) {
      return preview?.availableDays != null
        ? t('dashboard:request.errors.insufficientBalance', { count: preview.availableDays })
        : t('dashboard:request.errors.insufficientBalanceUnknown')
    }
    return error.problem.detail ?? fallback
  }

  const previewErrorMessage =
    previewQuery.error instanceof ApiError
      ? problemMessage(previewQuery.error, t('dashboard:request.errors.preview'))
      : previewQuery.isError
        ? t('dashboard:request.errors.preview')
        : null

  const previewState: WorkingDayExplainerState = viewerUngrouped
    ? 'error'
    : clientDateInvalid
    ? 'error'
    : !previewEnabled
      ? 'before-dates'
      : previewQuery.isPending
        ? 'loading'
        : previewErrorMessage
          ? 'error'
          : preview
            ? preview.workingDays == null
              ? 'error'
              : preview.workingDays === 0
                ? 'zero'
                : 'valid'
            : 'loading'

  const previewStateMessage = viewerUngrouped
    ? t('dashboard:request.errors.noWorkforceGroup')
    : previewState === 'error'
      ? clientDateInvalid
        ? t('dashboard:request.preview.dateRange')
        : previewErrorMessage ?? t('dashboard:request.errors.preview')
      : previewState === 'before-dates'
        ? t('dashboard:request.preview.selectDates')
        : previewState === 'loading'
          ? t('dashboard:request.preview.calculating')
          : previewState === 'zero' && preview
            ? t('dashboard:request.preview.zero', { name: isolate(preview.workforceGroupName ?? '') })
            : ''

  // Plan RESTO: which bucket the request draws on, in the server's own numbers (AD-4). Shown only
  // when carried days are involved; a request paid wholly from this year needs no breakdown.
  let carryoverBreakdown: string | null = null
  if (
    previewState === 'valid' &&
    preview?.availableDays != null &&
    (preview.carryoverDaysToUse ?? 0) > 0
  ) {
    const carried = t('dashboard:request.breakdown.carried', {
      count: preview.carryoverDaysToUse ?? 0,
      date: isolate(formatDate(preview.carryoverExpiresOn ?? '', i18n.language)),
    })
    carryoverBreakdown =
      (preview.currentDaysToUse ?? 0) > 0
        ? t('dashboard:request.breakdown.usesBoth', {
            first: carried,
            second: t('dashboard:request.breakdown.current', {
              count: preview.currentDaysToUse ?? 0,
              year: isolate(preview.balanceYear),
            }),
            available: isolate(preview.availableDays),
          })
        : t('dashboard:request.breakdown.usesOne', {
            part: carried,
            available: isolate(preview.availableDays),
          })
  }

  const submitDisabled =
    viewerUngrouped ||
    leaveTypeId === '' ||
    !previewEnabled ||
    clientDateInvalid ||
    previewQuery.isPending ||
    previewQuery.isFetching ||
    previewQuery.isError ||
    preview == null ||
    preview.workingDays == null ||
    preview.workingDays === 0 ||
    createMutation.isPending

  useEffect(() => {
    if (!open) {
      setLeaveTypeId('')
      setDateFrom('')
      setDateTo('')
      setNote('')
      setSubmitErrorMessage(null)
      setFieldErrors({})
      resetCreateMutation()
    }
  }, [open, resetCreateMutation])

  if (!open) {
    return null
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitDisabled) {
      return
    }

    const selectedLeaveTypeId = leaveTypeId as number
    const trimmedNote = note.trim()

    setSubmitErrorMessage(null)
    setFieldErrors({})
    createMutation.mutate(
      {
        leaveTypeId: selectedLeaveTypeId,
        dateFrom,
        dateTo,
        note: trimmedNote === '' ? undefined : trimmedNote,
      },
      {
        onSuccess: () => {
          onSuccess?.()
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError) {
            const nextFieldErrors = fieldErrorsFromApiError(error.fieldViolations)
            if (nextFieldErrors) {
              setFieldErrors(
                Object.fromEntries(
                  Object.entries(nextFieldErrors).map(([field, message]) => [
                    field,
                    translateFieldViolation(field, message),
                  ]),
                ),
              )
              return
            }
            setSubmitErrorMessage(problemMessage(error, t('dashboard:request.errors.submit')))
            return
          }
          setSubmitErrorMessage(t('dashboard:request.errors.submit'))
        },
      },
    )
  }

  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function fieldErrorProps(field: keyof typeof LEAVE_REQUEST_FIELD_IDS) {
    const fieldId = LEAVE_REQUEST_FIELD_IDS[field]
    const message = fieldErrors[field]
    if (!message) {
      return { message: undefined, fieldId, invalid: false, describedBy: undefined }
    }
    return {
      message,
      fieldId,
      invalid: true,
      describedBy: `field-error-${fieldId}`,
    }
  }

  const leaveTypeError = fieldErrorProps('leaveTypeId')
  const dateFromError = fieldErrorProps('dateFrom')
  const dateToError = fieldErrorProps('dateTo')
  const noteError = fieldErrorProps('note')

  return (
    <Modal
      labelledBy="request-leave-modal-title"
      onClose={onClose}
      className="request-leave-modal"
      testId="request-leave-modal"
      closeOnBackdrop={false}
    >
      <div className="modal-header">
          <span className="modal-title" id="request-leave-modal-title">
            {t('dashboard:request.title')}
          </span>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('common:actions.close')}>
            <CloseIcon size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="leave-type">{t('dashboard:request.fields.leaveType')}</label>
            <select
              id="leave-type"
              value={leaveTypeId}
              onChange={(event) => {
                setLeaveTypeId(event.target.value === '' ? '' : Number(event.target.value))
                clearFieldError('leaveTypeId')
              }}
              required
              aria-invalid={leaveTypeError.invalid || undefined}
              aria-describedby={leaveTypeError.describedBy}
            >
              <option value="">{t('dashboard:request.fields.selectLeaveType')}</option>
              {(leaveTypesQuery.data ?? []).map((leaveType) => (
                <option key={leaveType.id} value={leaveType.id} dir="auto">
                  {leaveType.icon ? `${leaveType.icon} ` : ''}
                  {leaveType.name}
                </option>
              ))}
            </select>
            {leaveTypeError.message && (
              <FieldErrorMessage fieldId={leaveTypeError.fieldId} message={leaveTypeError.message} />
            )}
          </div>

          <div className="form-group date-row">
            <div className="form-group">
              <label htmlFor="leave-from-date">{t('dashboard:request.fields.from')}</label>
              <DateField
                id="leave-from-date"
                data-testid="leave-from-date"
                value={dateFrom}
                onChange={(value) => {
                  setDateFrom(value)
                  clearFieldError('dateFrom')
                }}
                aria-label={t('dashboard:request.fields.fromDate')}
                aria-invalid={dateFromError.invalid || undefined}
                aria-describedby={dateFromError.describedBy}
              />
              {dateFromError.message && (
                <FieldErrorMessage fieldId={dateFromError.fieldId} message={dateFromError.message} />
              )}
            </div>
            <div className="form-group">
              <label htmlFor="leave-to-date">{t('dashboard:request.fields.to')}</label>
              <DateField
                id="leave-to-date"
                data-testid="leave-to-date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(value) => {
                  setDateTo(value)
                  clearFieldError('dateTo')
                }}
                aria-label={t('dashboard:request.fields.toDate')}
                aria-invalid={dateToError.invalid || undefined}
                aria-describedby={dateToError.describedBy}
              />
              {dateToError.message && (
                <FieldErrorMessage fieldId={dateToError.fieldId} message={dateToError.message} />
              )}
            </div>
          </div>

          <div className="working-day-preview" data-testid="working-day-preview">
            <WorkingDayExplainer
              state={previewState}
              stateMessage={previewStateMessage}
              resultLabel={
                preview
                  ? preview.workingDays > 0
                    ? t('dashboard:request.preview.charged', { count: preview.workingDays })
                    : t('dashboard:request.preview.zeroResult')
                  : undefined
              }
              policyLabel={
                preview
                  ? t('dashboard:request.preview.context', {
                      name: preview.workforceGroupName ?? '',
                    })
                  : undefined
              }
              excludedSummary={
                excludedTotal > 0
                  ? t('dashboard:request.preview.excluded', { count: excludedTotal })
                  : undefined
              }
              retryLabel={
                previewState === 'error' && !clientDateInvalid && !viewerUngrouped
                  ? t('common:actions.retry')
                  : undefined
              }
              onRetry={
                previewState === 'error' && !clientDateInvalid && !viewerUngrouped
                  ? () => void previewQuery.refetch()
                  : undefined
              }
            />
            {carryoverBreakdown ? (
              <p className="request-carryover-breakdown" data-testid="request-carryover-breakdown">
                {carryoverBreakdown}
              </p>
            ) : null}
          </div>

          {submitErrorMessage && (
            <p className="preview-error" role="alert">
              {submitErrorMessage}
            </p>
          )}

          <div className="form-group">
            <label htmlFor="leave-note">{t('dashboard:request.fields.note')}</label>
            <textarea
              id="leave-note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
                clearFieldError('note')
              }}
              rows={3}
              aria-invalid={noteError.invalid || undefined}
              aria-describedby={noteError.describedBy}
            />
            {noteError.message && (
              <FieldErrorMessage fieldId={noteError.fieldId} message={noteError.message} />
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="submit-request-btn"
              disabled={submitDisabled}
              data-busy={createMutation.isPending ? 'true' : undefined}
            >
              {createMutation.isPending
                ? t('dashboard:request.actions.submitting')
                : t('dashboard:request.actions.submit')}
            </button>
          </div>
        </form>
    </Modal>
  )
}
