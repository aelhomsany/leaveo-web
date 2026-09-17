import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  compensateBalanceCorrection,
  getPolicySettingsOverview,
  listBalanceCorrections,
  previewBalanceCorrection,
  recordBalanceCorrection,
} from '../../api/client'
import type { BalanceCorrectionResponse, components } from '../../api/generated/types'
import { DateField } from '../../components/DateField'
import { formatLeaveDays } from '../../lib/leaveDays'
import { HorizontalScrollRegion } from '../../components/ui/HorizontalScrollRegion'
import { Modal } from '../../components/ui/Modal'
import { CloseIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/useToast'
import './corrections.css'

const KNOWN_KINDS = new Set(['MANUAL_CORRECTION', 'COMPENSATION', 'OPENING_IMPORT'])

const LEDGER_PAGE_SIZE = 50

// The list page's own `Required<>` alias only forces its top-level fields (`items`, `page`, ...)
// non-optional; the array element keeps the raw generated shape, where every field is still
// optional. Typing rows against that raw shape (rather than the `Required<>` convenience alias)
// is what the compiler actually receives from `listBalanceCorrections()`.
type LedgerRow = components['schemas']['BalanceCorrectionListItemResponse']

type FormState = {
  userPublicId: string
  leaveTypePublicId: string
  deltaDays: string
  reason: string
  effectiveDate: string
  notifyUser: boolean
}

function emptyForm(): FormState {
  return { userPublicId: '', leaveTypePublicId: '', deltaDays: '', reason: '', effectiveDate: '', notifyUser: false }
}

type CompensateDraft = {
  reason: string
  effectiveDate: string
  notifyUser: boolean
}

export function CorrectionsPage() {
  const { t } = useTranslation(['corrections', 'common'])
  const { showToast } = useToast()
  const queryClient = useQueryClient()

  const [capabilityUnavailable, setCapabilityUnavailable] = useState(false)
  const [ledgerPage, setLedgerPage] = useState(0)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lastResult, setLastResult] = useState<BalanceCorrectionResponse | null>(null)
  const [compensateTarget, setCompensateTarget] = useState<LedgerRow | null>(null)
  const [compensateDraft, setCompensateDraft] = useState<CompensateDraft>({
    reason: '',
    effectiveDate: '',
    notifyUser: false,
  })
  const [compensateError, setCompensateError] = useState<string | null>(null)
  // Optimistically hidden the instant a compensation succeeds, so a slow refetch cannot leave the
  // button clickable again for the id that just landed a 201.
  const [locallyCompensated, setLocallyCompensated] = useState<Set<number>>(new Set())

  const referenceQuery = useQuery({
    queryKey: ['policy-settings-overview', 'corrections'],
    queryFn: getPolicySettingsOverview,
    retry: false,
  })

  const ledgerQuery = useQuery({
    queryKey: ['balance-corrections', 'ledger', ledgerPage],
    queryFn: () => listBalanceCorrections(undefined, undefined, ledgerPage, LEDGER_PAGE_SIZE),
    retry: false,
  })

  useEffect(() => {
    const denied =
      (ledgerQuery.error instanceof ApiError && ledgerQuery.error.problem.code === 'capability-unavailable') ||
      (referenceQuery.error instanceof ApiError && referenceQuery.error.problem.code === 'capability-unavailable')
    if (denied) setCapabilityUnavailable(true)
  }, [ledgerQuery.error, referenceQuery.error])

  const userLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const user of referenceQuery.data?.users ?? []) {
      if (user.publicId) map.set(user.publicId, user.name ?? user.publicId)
    }
    return map
  }, [referenceQuery.data?.users])

  const leaveTypeLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const leaveType of referenceQuery.data?.leaveTypes ?? []) {
      if (leaveType.leaveTypePublicId) {
        map.set(leaveType.leaveTypePublicId, leaveType.name ?? leaveType.leaveTypePublicId)
      }
    }
    return map
  }, [referenceQuery.data?.leaveTypes])

  const recordMutation = useMutation({
    mutationFn: () =>
      recordBalanceCorrection({
        userPublicId: form.userPublicId,
        leaveTypePublicId: form.leaveTypePublicId,
        deltaDays: Number(form.deltaDays),
        reason: form.reason,
        effectiveDate: form.effectiveDate,
        notifyUser: form.notifyUser,
      }),
    onSuccess: (response) => {
      setConfirmOpen(false)
      setLastResult(response)
      setForm(emptyForm())
      setFormError(null)
      showToast(t('corrections:actions.record'))
      void queryClient.invalidateQueries({ queryKey: ['balance-corrections', 'ledger'] })
    },
    onError: (cause) => {
      setConfirmOpen(false)
      if (cause instanceof ApiError && cause.problem.code === 'capability-unavailable') {
        setCapabilityUnavailable(true)
        return
      }
      setFormError(
        cause instanceof ApiError
          ? cause.problem.detail ?? t('corrections:errors.recordFailed')
          : t('corrections:errors.recordFailed'),
      )
    },
  })

  const compensateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CompensateDraft }) =>
      compensateBalanceCorrection(id, {
        reason: payload.reason,
        effectiveDate: payload.effectiveDate,
        notifyUser: payload.notifyUser,
      }),
    onSuccess: (_response, variables) => {
      setLocallyCompensated((current) => new Set(current).add(variables.id))
      setCompensateTarget(null)
      setCompensateError(null)
      showToast(t('corrections:actions.compensate'))
      void queryClient.invalidateQueries({ queryKey: ['balance-corrections', 'ledger'] })
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.problem.code === 'capability-unavailable') {
        // A permanently gated capability is not retryable — show the same banner the record
        // path shows rather than an inline error next to a live Confirm button.
        setCompensateTarget(null)
        setCapabilityUnavailable(true)
        return
      }
      if (cause instanceof ApiError) {
        setCompensateError(
          cause.problem.detail ??
            (cause.status === 409
              ? t('corrections:errors.alreadyCompensated')
              : t('corrections:errors.compensateFailed')),
        )
        return
      }
      // Non-ApiError means transport, not a server verdict: never claim "already compensated".
      setCompensateError(t('corrections:errors.compensateFailed'))
    },
  })

  // `deltaDays` is an `int` on the server and a zero-day adjustment is a no-op ledger entry, so
  // `step="1"` alone is not enough: the form sets `noValidate`, which suppresses it entirely.
  const deltaValue = Number(form.deltaDays)
  const deltaValid =
    form.deltaDays.trim() !== '' && Number.isInteger(deltaValue) && deltaValue !== 0

  const canReview =
    Boolean(form.userPublicId) &&
    Boolean(form.leaveTypePublicId) &&
    deltaValid &&
    Boolean(form.reason.trim()) &&
    Boolean(form.effectiveDate)

  // Server-computed before/delta/after for the pending correction (UX-DR72/AC2). Fetched only
  // while the confirm modal is open; the SPA never derives a balance itself.
  const previewQuery = useQuery({
    queryKey: [
      'balance-correction-preview',
      form.userPublicId,
      form.leaveTypePublicId,
      form.deltaDays,
      form.effectiveDate,
    ],
    queryFn: () =>
      previewBalanceCorrection({
        userPublicId: form.userPublicId,
        leaveTypePublicId: form.leaveTypePublicId,
        deltaDays: deltaValue,
        effectiveDate: form.effectiveDate,
      }),
    enabled: confirmOpen && canReview,
    retry: false,
    staleTime: 0,
  })

  const openConfirm = () => {
    if (!canReview) {
      setFormError(
        form.deltaDays.trim() !== '' && !deltaValid
          ? t('corrections:errors.deltaInvalid')
          : t('corrections:errors.validation'),
      )
      return
    }
    setFormError(null)
    setConfirmOpen(true)
  }

  const openCompensate = (row: LedgerRow) => {
    setCompensateTarget(row)
    setCompensateDraft({ reason: '', effectiveDate: '', notifyUser: false })
    setCompensateError(null)
  }

  if (capabilityUnavailable) {
    return (
      <div className="page page-wide corrections-page" data-testid="corrections-page">
        <header className="page-header corrections-page-header">
          <h1 className="page-title">{t('corrections:title')}</h1>
        </header>
        <section className="card corrections-unavailable" role="alert" data-testid="corrections-capability-unavailable">
          <h2>{t('corrections:capabilityUnavailable.title')}</h2>
          <p>{t('corrections:capabilityUnavailable.body')}</p>
        </section>
      </div>
    )
  }

  const ledgerItems = ledgerQuery.data?.items ?? []
  const ledgerTotal = ledgerQuery.data?.total ?? ledgerItems.length
  const ledgerSize =
    ledgerQuery.data?.size && ledgerQuery.data.size > 0 ? ledgerQuery.data.size : LEDGER_PAGE_SIZE
  const ledgerTotalPages = Math.max(1, Math.ceil(ledgerTotal / ledgerSize))
  const preview = previewQuery.data

  return (
    <div className="page page-wide corrections-page" data-testid="corrections-page">
      <header className="page-header corrections-page-header">
        <div>
          <p className="panel-eyebrow">{t('corrections:eyebrow')}</p>
          <h1 className="page-title">{t('corrections:title')}</h1>
          <p className="page-sub">{t('corrections:subtitle')}</p>
        </div>
        <dl className="corrections-page-kpis" aria-label={t('corrections:ledger.band.countTitle')}>
          <div>
            <dt>{t('corrections:ledger.band.entriesLabel')}</dt>
            <dd>{ledgerQuery.isPending || ledgerQuery.isError ? '—' : ledgerTotal}</dd>
          </div>
          <div>
            <dt>{t('corrections:ledger.band.pagesLabel')}</dt>
            <dd>{ledgerQuery.isPending || ledgerQuery.isError ? '—' : ledgerTotalPages}</dd>
          </div>
        </dl>
      </header>

      {/* `.page` is padding, not a gapped grid, so these sections stacked flush against one
          another with no rhythm at all. `.panel-stack` is the shared vocabulary for exactly
          this. The modals stay OUTSIDE it: a native <dialog> is a DOM child of whatever
          renders it, and the stack's layout rules have no business reaching into the top
          layer. */}
      <div className="panel-stack">
        <section className="card corrections-form-card" aria-labelledby="correction-form-title" data-testid="correction-form">
          <div className="corrections-card-heading">
            <div>
              <p className="corrections-card-kicker">{t('corrections:eyebrow')}</p>
              <h2 id="correction-form-title">{t('corrections:form.title')}</h2>
            </div>
            <span className="corrections-card-step" aria-hidden="true">01</span>
          </div>
          {referenceQuery.isError && (
            <p className="field-error" role="alert" data-testid="correction-reference-error">
              {t('corrections:errors.referenceDataFailed')}
            </p>
          )}
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              openConfirm()
            }}
          >
            <div className="panel-filter-grid">
              <div className="form-group">
                <label htmlFor="correction-user">{t('corrections:form.user')}</label>
                <select
                  id="correction-user"
                  value={form.userPublicId}
                  onChange={(event) => setForm((current) => ({ ...current, userPublicId: event.target.value }))}
                >
                  <option value="">{t('corrections:form.userPlaceholder')}</option>
                  {(referenceQuery.data?.users ?? []).map((user) => (
                    <option key={user.publicId} value={user.publicId} dir="auto">
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="correction-leave-type">{t('corrections:form.leaveType')}</label>
                <select
                  id="correction-leave-type"
                  value={form.leaveTypePublicId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, leaveTypePublicId: event.target.value }))}
                >
                  <option value="">{t('corrections:form.leaveTypePlaceholder')}</option>
                  {(referenceQuery.data?.leaveTypes ?? []).map((leaveType) => (
                    <option key={leaveType.leaveTypePublicId} value={leaveType.leaveTypePublicId} dir="auto">
                      {leaveType.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="correction-delta">{t('corrections:form.deltaDays')}</label>
                <input
                  id="correction-delta"
                  type="number"
                  step="1"
                  value={form.deltaDays}
                  onChange={(event) => setForm((current) => ({ ...current, deltaDays: event.target.value }))}
                />
                <p className="panel-filter-hint">{t('corrections:form.deltaHint')}</p>
              </div>

              <div className="form-group">
                <label htmlFor="correction-effective-date">{t('corrections:form.effectiveDate')}</label>
                <DateField
                  id="correction-effective-date"
                  value={form.effectiveDate}
                  onChange={(value) => setForm((current) => ({ ...current, effectiveDate: value }))}
                />
              </div>

              <div className="form-group">
                <label htmlFor="correction-reason">{t('corrections:form.reason')}</label>
                <textarea
                  id="correction-reason"
                  value={form.reason}
                  onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </div>

              <label className="panel-checkbox" htmlFor="correction-notify">
                <input
                  id="correction-notify"
                  type="checkbox"
                  checked={form.notifyUser}
                  onChange={(event) => setForm((current) => ({ ...current, notifyUser: event.target.checked }))}
                />
                <span>{t('corrections:form.notifyUser')}</span>
              </label>
            </div>

            {formError && (
              <p className="field-error" role="alert">
                {formError}
              </p>
            )}

            <div className="panel-filter-actions">
              <button type="submit" className="btn btn-primary">
                {t('corrections:actions.review')}
              </button>
            </div>
          </form>
        </section>

        {lastResult && (
          <section className="card corrections-result-card" aria-labelledby="correction-result-title" data-testid="correction-result">
            <div className="corrections-card-heading">
              <h2 id="correction-result-title">{t('corrections:result.title')}</h2>
              <span className="corrections-result-seal" aria-hidden="true">✓</span>
            </div>
            <dl className="corrections-result-metrics">
              <div>
                <dt>{t('corrections:result.before')}</dt>
                <dd>{lastResult.beforeRemainingDays}</dd>
              </div>
              <div>
                <dt>{t('corrections:result.after')}</dt>
                <dd>{lastResult.afterRemainingDays}</dd>
              </div>
            </dl>
          </section>
        )}

        {/* A band, not a rail: the ledger's seven columns want 1040px of min-content against
            a 1121px panel, so a 300px rail beside it would leave the table 797px and force a
            permanent sideways scroll inside a narrowed column. */}
        <div className="support-band corrections-ledger-band" data-testid="corrections-ledger-band">
          <div className="support-note corrections-ledger-note">
            <p className="support-note-title">{t('corrections:ledger.band.countTitle')}</p>
            <dl className="support-note-list">
              <div className="support-note-kv">
                <dt>{t('corrections:ledger.band.entriesLabel')}</dt>
                <dd data-testid="corrections-ledger-entries">
                  {ledgerQuery.isPending || ledgerQuery.isError ? '—' : ledgerTotal}
                </dd>
              </div>
              <div className="support-note-kv">
                <dt>{t('corrections:ledger.band.pagesLabel')}</dt>
                <dd data-testid="corrections-ledger-pages">
                  {ledgerQuery.isPending || ledgerQuery.isError ? '—' : ledgerTotalPages}
                </dd>
              </div>
            </dl>
            <p className="support-note-body support-note-footnote">
              {t('corrections:ledger.band.countFootnote')}
            </p>
          </div>
          <div className="support-note corrections-ledger-note">
            <p className="support-note-title">{t('corrections:ledger.band.meaningTitle')}</p>
            <p className="support-note-body">{t('corrections:ledger.band.meaningBody')}</p>
          </div>
          <div className="support-note corrections-ledger-note">
            <p className="support-note-title">{t('corrections:ledger.band.readingTitle')}</p>
            <ul className="support-note-bullets">
              <li>{t('corrections:ledger.band.readingDelta')}</li>
              <li>{t('corrections:ledger.band.readingEffectiveDate')}</li>
              <li>{t('corrections:ledger.band.readingCompensate')}</li>
            </ul>
          </div>
      </div>

      <section className="panel-results card corrections-ledger-card" aria-labelledby="correction-ledger-title" data-testid="correction-ledger">
        <div className="card-header">
          <h2 className="card-title" id="correction-ledger-title">
            {t('corrections:ledger.title')}
          </h2>
        </div>
        {ledgerQuery.isError && (
          <p className="field-error" role="alert">
            {t('corrections:errors.listFailed')}
          </p>
        )}
        {ledgerItems.length === 0 ? (
          <div className="dashboard-empty-state" data-testid="correction-ledger-empty">
            <p>{t('corrections:ledger.empty')}</p>
          </div>
        ) : (
          <HorizontalScrollRegion
            labelledBy="correction-ledger-title"
            describedById="correction-ledger-scroll-hint"
            testId="correction-ledger-region"
          >
            <table className="dashboard-table table-compact">
              <thead>
                <tr>
                  <th scope="col">{t('corrections:ledger.columns.user')}</th>
                  <th scope="col">{t('corrections:ledger.columns.leaveType')}</th>
                  <th scope="col">{t('corrections:ledger.columns.kind')}</th>
                  <th scope="col">{t('corrections:ledger.columns.delta')}</th>
                  <th scope="col">{t('corrections:ledger.columns.effectiveDate')}</th>
                  <th scope="col">{t('corrections:ledger.columns.reason')}</th>
                  <th scope="col">{t('corrections:ledger.columns.status')}</th>
                </tr>
              </thead>
              <tbody>
                {ledgerItems.map((row) => {
                  const compensated = Boolean(row.compensated) || (row.id != null && locallyCompensated.has(row.id))
                  const isCompensating =
                    compensateMutation.isPending && compensateMutation.variables?.id === row.id
                  return (
                    <tr key={row.id} data-testid={`correction-row-${row.id}`}>
                      <td dir="auto">{row.userPublicId ? userLabel.get(row.userPublicId) ?? row.userPublicId : '—'}</td>
                      <td dir="auto">
                        {row.leaveTypePublicId ? leaveTypeLabel.get(row.leaveTypePublicId) ?? row.leaveTypePublicId : '—'}
                      </td>
                      <td>
                        {row.kind && KNOWN_KINDS.has(row.kind) ? t(`corrections:ledger.kind.${row.kind}`) : row.kind}
                      </td>
                      <td>{formatLeaveDays(row.deltaDays)}</td>
                      <td>
                        {row.effectiveDate ? <time dateTime={row.effectiveDate}>{row.effectiveDate}</time> : '—'}
                      </td>
                      <td dir="auto">{row.reason}</td>
                      <td>
                        {compensated ? (
                          <span data-testid={`correction-compensated-${row.id}`}>
                            {t('corrections:ledger.compensated')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={isCompensating}
                            data-testid={`correction-compensate-${row.id}`}
                            onClick={() => openCompensate(row)}
                          >
                            {isCompensating ? t('corrections:actions.compensating') : t('corrections:actions.compensate')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </HorizontalScrollRegion>
        )}

        <div className="panel-pagination">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={ledgerPage === 0}
            data-testid="correction-ledger-previous"
            onClick={() => setLedgerPage((page) => Math.max(0, page - 1))}
          >
            {t('corrections:ledger.pagination.previous')}
          </button>
          <p role="status" aria-live="polite" data-testid="correction-ledger-pagination-status">
            {t('corrections:ledger.pagination.status', {
              page: ledgerPage + 1,
              totalPages: ledgerTotalPages,
              total: ledgerTotal,
            })}
          </p>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={ledgerPage + 1 >= ledgerTotalPages}
            data-testid="correction-ledger-next"
            onClick={() => setLedgerPage((page) => page + 1)}
          >
            {t('corrections:ledger.pagination.next')}
          </button>
        </div>
      </section>
      </div>

      {confirmOpen && (
        <Modal labelledBy="correction-confirm-title" onClose={() => setConfirmOpen(false)} closeOnBackdrop={false}>
          <div className="modal-header">
            <h2 className="modal-title" id="correction-confirm-title">
              {t('corrections:confirm.title')}
            </h2>
            <button
              type="button"
              className="modal-close"
              aria-label={t('corrections:actions.close')}
              onClick={() => setConfirmOpen(false)}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="modal-body">
            <p>
              {t('corrections:confirm.summary', {
                delta: form.deltaDays,
                user: userLabel.get(form.userPublicId) ?? form.userPublicId,
                leaveType: leaveTypeLabel.get(form.leaveTypePublicId) ?? form.leaveTypePublicId,
                date: form.effectiveDate,
              })}
            </p>
            <p>{t('corrections:confirm.reasonLabel', { reason: form.reason })}</p>

            {previewQuery.isPending && (
              <p data-testid="correction-preview-loading">{t('corrections:confirm.preview.loading')}</p>
            )}
            {previewQuery.isError && (
              <p className="field-error" role="alert" data-testid="correction-preview-error">
                {t('corrections:confirm.preview.failed')}
              </p>
            )}
            {preview && (
              <dl data-testid="correction-preview">
                <div>
                  <dt>{t('corrections:confirm.preview.before')}</dt>
                  <dd data-testid="correction-preview-before">
                    {formatLeaveDays(preview.beforeRemainingDays)}
                  </dd>
                </div>
                <div>
                  <dt>{t('corrections:confirm.preview.delta')}</dt>
                  <dd data-testid="correction-preview-delta">
                    {preview.deltaDays > 0
                      ? `+${formatLeaveDays(preview.deltaDays)}`
                      : formatLeaveDays(preview.deltaDays)}
                  </dd>
                </div>
                <div>
                  <dt>{t('corrections:confirm.preview.after')}</dt>
                  <dd data-testid="correction-preview-after">
                    {formatLeaveDays(preview.afterRemainingDays)}
                  </dd>
                </div>
              </dl>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)}>
              {t('common:actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-success"
              // A blind confirm is barred: without the server's before/after there is no evidence
              // to review, which is exactly what UX-DR72 requires be seen first.
              disabled={recordMutation.isPending || !preview}
              onClick={() => recordMutation.mutate()}
            >
              {recordMutation.isPending ? t('corrections:actions.recording') : t('corrections:actions.record')}
            </button>
          </div>
        </Modal>
      )}

      {compensateTarget && (
        <Modal
          labelledBy="correction-compensate-title"
          onClose={() => setCompensateTarget(null)}
          closeOnBackdrop={false}
        >
          <div className="modal-header">
            <h2 className="modal-title" id="correction-compensate-title">
              {t('corrections:compensateConfirm.title')}
            </h2>
            <button
              type="button"
              className="modal-close"
              aria-label={t('corrections:actions.close')}
              onClick={() => setCompensateTarget(null)}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="modal-body">
            <p>{t('corrections:compensateConfirm.body')}</p>
            <div className="form-group">
              <label htmlFor="compensate-reason">{t('corrections:compensateConfirm.reason')}</label>
              <textarea
                id="compensate-reason"
                value={compensateDraft.reason}
                onChange={(event) =>
                  setCompensateDraft((current) => ({ ...current, reason: event.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="compensate-effective-date">
                {t('corrections:compensateConfirm.effectiveDate')}
              </label>
              <DateField
                id="compensate-effective-date"
                value={compensateDraft.effectiveDate}
                onChange={(value) => setCompensateDraft((current) => ({ ...current, effectiveDate: value }))}
              />
            </div>
            <label className="panel-checkbox" htmlFor="compensate-notify">
              <input
                id="compensate-notify"
                type="checkbox"
                checked={compensateDraft.notifyUser}
                onChange={(event) =>
                  setCompensateDraft((current) => ({ ...current, notifyUser: event.target.checked }))}
              />
              <span>{t('corrections:compensateConfirm.notifyUser')}</span>
            </label>
            {compensateError && (
              <p className="field-error" role="alert">
                {compensateError}
              </p>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setCompensateTarget(null)}>
              {t('corrections:actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={
                compensateMutation.isPending ||
                !compensateDraft.reason.trim() ||
                !compensateDraft.effectiveDate
              }
              onClick={() => {
                if (!compensateTarget?.id) return
                compensateMutation.mutate({ id: compensateTarget.id, payload: compensateDraft })
              }}
            >
              {t('corrections:actions.confirmCompensate')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
