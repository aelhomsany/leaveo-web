import { useTranslation } from 'react-i18next'
import { isolate } from '../../i18n/bidi'
import { formatLeaveDays } from '../../lib/leaveDays'
import type { PendingApprovalResponse } from '../../api/generated/types'
import { WorkingDayExplainer } from '../../components/ui/WorkingDayExplainer'
import { CheckIcon } from '../../components/ui/icons'
import { LeaveTypeTag } from '../dashboard/LeaveTypeTag'
import { formatDate, formatDateRange } from '../dashboard/leaveRequestFormatting'
import { ApprovalProgress } from './ApprovalProgress'

type ApprovalCoverage = {
  /**
   * Server-derived count of **colleagues away** over this request's window
   * (`PendingApprovalResponse.overlappingApprovedAbsences`). The interval math is a
   * read-model fact computed by the API — the SPA never recomputes it, and when the
   * fact is absent the card falls back to the partial-coverage copy rather than
   * inventing a number.
   *
   * Since Story 13.4 this is the `approvedOffCount` of the same decision-facts
   * projection the card renders below: distinct people, scoped to the requester's
   * Workforce Group, evaluated over working days only, excluding the requester, the
   * viewing approver, and work-from-home leave types (a WFH colleague is present, not
   * away). It stays on the response only so an API deployed ahead of the SPA keeps
   * working; new code should read `approval.decisionFacts`. See
   * `ApprovalDecisionFactsAdapter#forAuthorizedApprovalInbox`.
   */
  overlappingAbsences: number | null | undefined
}

type ApprovalCardProps = {
  approval: PendingApprovalResponse
  coverage: ApprovalCoverage
  onApprove: () => void
  onDecline: () => void
  onConcern: () => void
  headingRef?: (element: HTMLHeadingElement | null) => void
  isApproving?: boolean
  isDeclining?: boolean
  isRecordingConcern?: boolean
  isStale?: boolean
}

const COUNT_UNCERTAINTY_CODES = [
  'WORKFORCE_GROUP_UNKNOWN',
  'CALENDAR_UNKNOWN',
  'SCHEDULE_UNKNOWN',
  'NO_WORKING_DAYS_IN_RANGE',
  'WINDOW_EXCEEDS_BOUND',
  'TIMEZONE_UNRESOLVED',
]

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
 * `Intl.DateTimeFormat` throws `RangeError` on a `timeZone` it does not recognise, which during
 * render takes down the entire approvals list rather than one field. The value is server-supplied
 * and only validated on the write paths, so it is treated as untrusted here: an unusable snapshot
 * is simply not shown.
 */
function formatSnapshotInstant(
  asOf: string | null | undefined,
  timezone: string | null | undefined,
  language: string,
): string | null {
  if (!asOf) return null
  const instant = new Date(asOf)
  if (Number.isNaN(instant.getTime())) return null
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'UTC',
    }).format(instant)
  } catch {
    return null
  }
}

export function ApprovalCard({
  approval,
  coverage,
  onApprove,
  onDecline,
  onConcern,
  headingRef,
  isApproving = false,
  isDeclining = false,
  isRecordingConcern = false,
  isStale = false,
}: ApprovalCardProps) {
  const { t, i18n } = useTranslation(['approvals', 'common'])
  const requestId = approval.requestId ?? 0
  const employeeName = approval.employeeFullName?.trim() || t('common:unknown')
  const workforceGroupName =
    approval.workforceGroupName?.trim() || t('approvals:context.groupUnavailable')
  const translatedWeekendDays = approval.weekendDays?.length
    ? approval.weekendDays
        .map((day) => t(`approvals:weekdays.${day}`, { defaultValue: day }))
        .join(', ')
    : null
  const weekendRule = translatedWeekendDays
    ? t('approvals:context.weekendRule', { days: translatedWeekendDays })
    : t('approvals:context.weekendUnavailable')
  const dateRange = formatDateRange(
    approval.dateFrom ?? '',
    approval.dateTo ?? '',
    i18n.language,
  )
  const workingDays = approval.workingDays ?? 0
  const note = approval.note?.trim()
  const busy = isApproving || isDeclining || isRecordingConcern
  const balanceInsufficient =
    approval.balanceCapped === true && approval.balanceSufficient === false
  const isOperationalLevel = (approval.approvalLevel ?? 1) === 1
  const approveDisabled = busy || isStale || (isOperationalLevel && (
    workingDays === 0 || balanceInsufficient
  ))
  let balanceText = t('approvals:balance.unavailable')
  if (approval.balanceCapped === false) {
    balanceText = t('approvals:balance.uncapped')
  } else if (
    approval.balanceCapped === true &&
    approval.balanceRemaining != null &&
    approval.balanceSufficient === false
  ) {
    balanceText = t('approvals:balance.insufficient', {
      remaining: isolate(formatLeaveDays(approval.balanceRemaining)),
      requested: isolate(formatLeaveDays(workingDays)),
    })
  } else if (
    approval.balanceCapped === true &&
    approval.balanceRemaining != null &&
    approval.balanceAfterApproval != null
  ) {
    // Plan RESTO: balanceRemaining already includes usable carried days; the carried share and its
    // deadline are named so the approver knows part of the balance is about to expire.
    balanceText =
      (approval.balanceCarryoverAvailable ?? 0) > 0
        ? t('approvals:balance.consequenceWithCarryover', {
            before: isolate(formatLeaveDays(approval.balanceRemaining)),
            carried: isolate(formatLeaveDays(approval.balanceCarryoverAvailable)),
            date: isolate(formatDate(approval.carryoverExpiresOn ?? '', i18n.language)),
            after: isolate(formatLeaveDays(approval.balanceAfterApproval)),
          })
        : t('approvals:balance.consequence', {
            before: isolate(formatLeaveDays(approval.balanceRemaining)),
            after: isolate(formatLeaveDays(approval.balanceAfterApproval)),
          })
  }

  const overlappingAbsences = coverage.overlappingAbsences
  const decisionFacts = approval.decisionFacts
  const factsAsOf = formatSnapshotInstant(
    decisionFacts?.asOf,
    decisionFacts?.timezone,
    i18n.language,
  )
  // Codes that describe the counts. Activation-provenance codes are reported on the age line
  // instead, so they never widen this sentence.
  const incompleteReasons = (decisionFacts?.uncertaintyCodes ?? [])
    .filter((code) => COUNT_UNCERTAINTY_CODES.includes(code))
    .map((code) => t(`approvals:facts.reasons.${code}`, { defaultValue: '' }))
    .filter((reason) => reason.length > 0)
  let coverageText: string
  if (typeof overlappingAbsences !== 'number') {
    // The server did not supply the coverage fact for this request — say so rather
    // than guessing a number.
    coverageText = t('approvals:coverage.partial', { group: isolate(workforceGroupName) })
  } else if (overlappingAbsences > 0) {
    coverageText = t('approvals:coverage.overlap', {
      // `count` stays numeric for plural selection; only the name is isolated.
      count: overlappingAbsences,
      group: isolate(workforceGroupName),
    })
  } else {
    coverageText = t('approvals:coverage.noOverlap', { group: isolate(workforceGroupName) })
  }

  return (
    <article
      className={[
        'approval-card',
        isStale ? 'approval-card--stale' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`approval-card-${requestId}`}
    >
      <div className="approval-card-header">
        <div className="approval-card-identity">
          <div className="approval-card-person">
            <span className="approval-card-avatar" aria-hidden="true">{initials(employeeName)}</span>
            <div>
              <p className="approval-card-eyebrow">{t('approvals:queue.requestEyebrow')}</p>
              <h3
                className="approval-card-title"
                data-testid={`approval-card-heading-${requestId}`}
                ref={headingRef}
                tabIndex={-1}
                dir="auto"
              >
                {employeeName}
              </h3>
              <div className="approval-card-leave-type">
                <LeaveTypeTag
                  icon={approval.leaveTypeIcon ?? ''}
                  name={approval.leaveTypeName ?? ''}
                  color={approval.leaveTypeColor ?? 'inherit'}
                  backgroundColor={approval.leaveTypeBackgroundColor ?? 'transparent'}
                  borderColor={approval.leaveTypeBorderColor ?? 'transparent'}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="approval-card-policy">
          <span className="approval-group-pill" dir="auto">{workforceGroupName}</span>
          <span className="approval-weekend-rule">{weekendRule}</span>
          {approval.nominalApproverFirstName ? (
            <>
              <span
                className="approval-reports-to-pill"
                data-testid={`assigned-approver-pill-${requestId}`}
              >
                {t('approvals:approver.assigned', {
                  name: isolate(approval.nominalApproverFirstName),
                })}
              </span>
              <p
                className="approval-on-behalf-notice"
                data-testid={`on-behalf-notice-${requestId}`}
              >
                {t('approvals:approver.actingOnBehalf', {
                  name: isolate(approval.nominalApproverFirstName),
                })}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="approval-card-facts">
        <div>
          <span>{t('approvals:context.dates')}</span>
          <strong>
            <bdi>{dateRange}</bdi>
          </strong>
        </div>
        <div>
          <span>{t('approvals:context.balanceAfter')}</span>
          <strong data-testid={`approval-balance-${requestId}`}>{balanceText}</strong>
        </div>
      </div>

      <p className="approval-card-step">
        {t('approvals:progress.currentLevel', { level: approval.approvalLevel ?? 1 })}
      </p>

      <ApprovalProgress evidence={approval.approvalEvidence} compact />

      <WorkingDayExplainer
        compact
        state={workingDays === 0 ? 'zero' : 'valid'}
        stateMessage={
          workingDays === 0
            ? t('approvals:workingDays.zero')
            : t('approvals:workingDays.authoritative')
        }
        resultLabel={t('approvals:table.workingDays', { count: workingDays })}
        policyLabel={t('approvals:workingDays.policy', {
          group: workforceGroupName,
          weekend: weekendRule,
        })}
        detailsLabel={t('approvals:workingDays.details')}
      />

      {decisionFacts ? (
        <section
          className="approval-decision-facts"
          aria-labelledby={`approval-decision-facts-title-${requestId}`}
          data-testid={`approval-decision-facts-${requestId}`}
        >
          <p className="approval-card-eyebrow">{t('approvals:facts.eyebrow')}</p>
          <h4 id={`approval-decision-facts-title-${requestId}`}>
            {t('approvals:facts.title')}
          </h4>

          <dl className="approval-decision-facts-list">
            {([
              ['scheduled', decisionFacts.scheduledCount],
              ['approvedOff', decisionFacts.approvedOffCount],
              ['pendingOff', decisionFacts.pendingOffCount],
              ['wfh', decisionFacts.wfhCount],
              ['available', decisionFacts.availableCount],
            ] as const).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`approvals:facts.labels.${key}`)}</dt>
                <dd>
                  {typeof value === 'number'
                    ? t(`approvals:facts.values.${key}`, { count: value })
                    : t('approvals:facts.unknown')}
                </dd>
              </div>
            ))}
          </dl>

          <div className="approval-decision-facts-evidence">
            <p>
              <strong>{t('approvals:facts.evaluatedRangeLabel')}</strong>{' '}
              {decisionFacts.evaluatedRange?.from && decisionFacts.evaluatedRange?.to
                ? formatDateRange(
                    decisionFacts.evaluatedRange.from,
                    decisionFacts.evaluatedRange.to,
                    i18n.language,
                  )
                : t('approvals:facts.unknown')}
            </p>
            <p>
              <strong>{t('approvals:facts.stageLabel')}</strong>{' '}
              {t('approvals:facts.stage', {
                current: decisionFacts.currentStage,
                total: decisionFacts.totalStages,
              })}
            </p>
            <p>
              <strong>{t('approvals:facts.ageLabel')}</strong>{' '}
              {typeof decisionFacts.pendingAgeDays === 'number'
                ? t('approvals:facts.age', { count: decisionFacts.pendingAgeDays })
                : t('approvals:facts.unknown')}
              {decisionFacts.activationProvenance === 'APPROXIMATE' ? (
                <>
                  {' · '}
                  <bdi>{t('approvals:facts.approximate')}</bdi>
                </>
              ) : null}
            </p>
            <p>
              <strong>{t('approvals:facts.snapshotLabel')}</strong>{' '}
              <bdi>{decisionFacts.timezone || t('approvals:facts.unknown')}</bdi>
              {factsAsOf ? (
                <>
                  {' · '}
                  <bdi>{factsAsOf}</bdi>
                </>
              ) : null}
            </p>
          </div>

          <div className="approval-decision-facts-holidays">
            <strong>{t('approvals:facts.holidaysLabel')}</strong>
            {!decisionFacts.holidays ? (
              <p>{t('approvals:facts.unknown')}</p>
            ) : decisionFacts.holidays.length ? (
              <ul>
                {decisionFacts.holidays.map((holiday, index) => (
                  <li key={`${holiday.dateFrom}-${holiday.name}-${index}`}>
                    <span dir="auto">{holiday.name}</span>{' · '}
                    <bdi>{formatDateRange(
                      holiday.dateFrom ?? '',
                      holiday.dateTo ?? holiday.dateFrom ?? '',
                      i18n.language,
                    )}</bdi>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t('approvals:facts.noHolidays')}</p>
            )}
          </div>

          {decisionFacts.incomplete ? (
            <p className="approval-decision-facts-uncertainty">
              {incompleteReasons.length
                ? t('approvals:facts.incompleteWithReasons', {
                    reasons: incompleteReasons.join(t('common:listSeparator')),
                  })
                : t('approvals:facts.incomplete', {
                    count: decisionFacts.unknownCount ?? 0,
                  })}
            </p>
          ) : null}
          <p className="approval-coverage-advisory">
            {t('approvals:coverage.advisory')}
          </p>
        </section>
      ) : (
        <section
          className="approval-card-coverage"
          aria-labelledby={`approval-coverage-title-${requestId}`}
          data-testid={`approval-coverage-${requestId}`}
        >
          <p className="approval-card-eyebrow">{t('approvals:coverage.eyebrow')}</p>
          <h4 id={`approval-coverage-title-${requestId}`}>
            {t('approvals:coverage.title')}
          </h4>
          <p>{coverageText}</p>
          <p className="approval-coverage-advisory">
            {t('approvals:coverage.advisory')}
          </p>
        </section>
      )}

      {note ? (
        <blockquote className="approval-card-note">
          <span>{t('approvals:context.employeeNote')}</span>
          <p dir="auto">{note}</p>
        </blockquote>
      ) : null}

      {isStale ? (
        <p className="approval-card-stale" role="status">
          {t('approvals:stale.card', { name: isolate(employeeName) })}
        </p>
      ) : null}

      {workingDays === 0 ? (
        <span id={`approval-zero-${requestId}`} className="sr-only">
          {t('approvals:workingDays.zero')}
        </span>
      ) : null}

      <div className="approval-actions">
        {isOperationalLevel ? (
          <button
            type="button"
            className="btn btn-danger-outline"
            data-testid={`decline-btn-${requestId}`}
            onClick={onDecline}
            disabled={busy || isStale}
            data-busy={isDeclining ? 'true' : undefined}
            aria-label={t('approvals:aria.declineRequest', { name: employeeName })}
          >
            {t('approvals:actions.decline')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-outline"
            data-testid={`concern-btn-${requestId}`}
            onClick={onConcern}
            disabled={busy || isStale}
            data-busy={isRecordingConcern ? 'true' : undefined}
            aria-label={t('approvals:aria.concernRequest', { name: employeeName })}
          >
            {t('approvals:actions.concern')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-success"
          data-testid={`approve-btn-${requestId}`}
          onClick={onApprove}
          disabled={approveDisabled}
          data-busy={isApproving ? 'true' : undefined}
          aria-describedby={
            workingDays === 0
              ? `approval-zero-${requestId}`
              : balanceInsufficient
                ? `approval-balance-${requestId}`
                : undefined
          }
          aria-label={t('approvals:aria.approveRequest', { name: employeeName })}
        >
          {t('approvals:actions.approve')} <CheckIcon size={16} />
        </button>
      </div>
    </article>
  )
}
