import { useState } from 'react'
import { LeaveTypeTag } from '../dashboard/LeaveTypeTag'
import { useTranslation } from 'react-i18next'
import { formatDateRange } from '../dashboard/leaveRequestFormatting'
import type { RecentApprovalDecisionResponse } from '../../api/generated/types'
import { AuditHistoryPanel } from './AuditHistoryPanel'
import { AuditHistoryToggle } from './AuditHistoryToggle'
import { ApprovalProgress } from './ApprovalProgress'

// employee, leave type, dates, days, status, decided by, decision date, audit, evidence.
// The disclosure row only renders when the audit column is present, so it always spans nine.
const DECISION_COLUMNS_WITH_AUDIT = 9

type RecentDecisionRowProps = {
  decision: RecentApprovalDecisionResponse
  showAuditHistory?: boolean
}

function formatDecisionDate(isoTimestamp: string, locale: string): string {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp
  }
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase()
}

export function RecentDecisionRow({ decision, showAuditHistory = false }: RecentDecisionRowProps) {
  const { t, i18n } = useTranslation(['approvals', 'common'])
  const [auditExpanded, setAuditExpanded] = useState(false)
  const requestId = decision.requestId ?? 0
  const employeeName = decision.employeeFullName?.trim() || t('common:unknown')
  const decisionResult = decision.decisionResult ?? 'APPROVED'
  const decisionBadgeClass = decisionResult === 'APPROVED'
    ? 'badge-approved'
    : decisionResult === 'DECLINED'
      ? 'badge-declined'
      : 'badge-pending'

  return (
    <>
    <tr data-testid={`recent-decision-row-${requestId}`}>
      <td>
        <div className="recent-decision-employee">
          <span className="recent-decision-avatar" aria-hidden="true">{initials(employeeName)}</span>
          <span>{employeeName}</span>
          {decision.decidedOnBehalf && decision.nominalApproverFirstName ? (
            <span
              className="approval-on-behalf-pill"
              data-testid={`recent-on-behalf-pill-${requestId}`}
            >
              {t('approvals:approver.onBehalf', { name: decision.nominalApproverFirstName })}
            </span>
          ) : null}
        </div>
      </td>
      <td>
        <LeaveTypeTag
          icon={decision.leaveTypeIcon ?? ''}
          name={decision.leaveTypeName ?? ''}
          color={decision.leaveTypeColor ?? 'inherit'}
          backgroundColor={decision.leaveTypeBackgroundColor ?? 'transparent'}
          borderColor={decision.leaveTypeBorderColor ?? 'transparent'}
        />
      </td>
      <td>{formatDateRange(decision.dateFrom ?? '', decision.dateTo ?? '', i18n.language)}</td>
      <td>{t('approvals:table.workingDays', { count: decision.workingDays ?? 0 })}</td>
      <td>
        <span className={`badge ${decisionBadgeClass}`}>
          {t(`approvals:progress.status.${decisionResult}`, { defaultValue: decisionResult })}
        </span>
      </td>
      <td>{decision.actorFirstName ?? t('common:unknown')}</td>
      <td>{formatDecisionDate(decision.decidedAt ?? '', i18n.language)}</td>
      {showAuditHistory ? (
        <td data-testid={`audit-history-expander-${requestId}`}>
          <AuditHistoryToggle
            requestId={requestId}
            employeeName={employeeName}
            expanded={auditExpanded}
            onToggle={() => setAuditExpanded((open) => !open)}
          />
        </td>
      ) : null}
      <td className="recent-decision-progress">
        <ApprovalProgress evidence={decision.approvalEvidence} compact />
      </td>
    </tr>
    {/* The panel goes in its own full-width row rather than in the audit cell. That cell
        starts ~700px into a table wider than a phone, so a panel opened there rendered
        entirely outside a 375px viewport — measured at x 693–993 with the scroll region
        at its origin. Spanning the table puts it under the record it belongs to at every
        width, and it scrolls with the row instead of away from it. */}
    {showAuditHistory && auditExpanded ? (
      <tr
        className="recent-decision-audit-row"
        data-testid={`recent-decision-audit-row-${requestId}`}
      >
        <td colSpan={DECISION_COLUMNS_WITH_AUDIT}>
          <AuditHistoryPanel
            requestId={requestId}
            panelId={`audit-history-${requestId}`}
          />
        </td>
      </tr>
    ) : null}
    </>
  )
}
