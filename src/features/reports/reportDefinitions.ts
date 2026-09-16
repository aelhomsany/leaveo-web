import type { ReportDefinitionKey } from '../../api/client'

export type ReportFilterKey =
  | 'dateRange'
  | 'workforceGroup'
  | 'leaveType'
  | 'status'
  | 'exceptionCode'
  | 'includeInactiveUsers'
  | 'balanceYear'

export type ReportColumn = {
  key: string
  labelKey: string
}

export type ReportSummaryField = {
  key: string
  labelKey: string
}

export type ReportDefinition = {
  key: ReportDefinitionKey
  labelKey: string
  descriptionKey: string
  filters: readonly ReportFilterKey[]
  defaultSort: string
  defaultDirection: 'ASC' | 'DESC'
  sortFields: readonly string[]
  columns: readonly ReportColumn[]
  summaryFields: readonly ReportSummaryField[]
  /** Values the status filter offers; request statuses unless a definition says otherwise. */
  statusOptions?: readonly string[]
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    key: 'BALANCE_SNAPSHOT',
    labelKey: 'definitions.balanceSnapshot.label',
    descriptionKey: 'definitions.balanceSnapshot.description',
    filters: ['workforceGroup', 'leaveType', 'includeInactiveUsers'],
    defaultSort: 'userName',
    defaultDirection: 'ASC',
    sortFields: ['userName', 'approvedUsage', 'remaining'],
    columns: [
      { key: 'userName', labelKey: 'columns.userName' },
      { key: 'workforceGroupName', labelKey: 'columns.workforceGroup' },
      { key: 'leaveTypeName', labelKey: 'columns.leaveType' },
      { key: 'presence', labelKey: 'columns.presence' },
      { key: 'allocation', labelKey: 'columns.allocation' },
      { key: 'approvedUsage', labelKey: 'columns.approvedUsage' },
      { key: 'adjustments', labelKey: 'columns.adjustments' },
      { key: 'remaining', labelKey: 'columns.remaining' },
      // Plan RESTO: carried days sit beside `remaining`, which keeps meaning this year's allowance.
      { key: 'carryoverAvailable', labelKey: 'columns.carryoverAvailable' },
      { key: 'exceptionCodes', labelKey: 'columns.exceptions' },
    ],
    summaryFields: [
      { key: 'userCount', labelKey: 'summary.users' },
      { key: 'totalAllocation', labelKey: 'summary.totalAllocation' },
      { key: 'totalApprovedUsage', labelKey: 'summary.totalApprovedUsage' },
      { key: 'totalRemaining', labelKey: 'summary.totalRemaining' },
      { key: 'totalCarryoverAvailable', labelKey: 'summary.totalCarryoverAvailable' },
      { key: 'exceptionCount', labelKey: 'summary.exceptions' },
      // Disclosure fields: the server sends these so a reader can tell "no allowance"
      // from "zero allowance", and so WFH is never read as absence. Dropping them
      // would present a partial total as a certain one.
      { key: 'uncappedRowCount', labelKey: 'summary.uncappedRows' },
      { key: 'totalsByPresence', labelKey: 'summary.totalsByPresence' },
    ],
  },
  {
    key: 'LEAVE_USAGE',
    labelKey: 'definitions.leaveUsage.label',
    descriptionKey: 'definitions.leaveUsage.description',
    filters: ['dateRange', 'workforceGroup', 'leaveType', 'includeInactiveUsers'],
    defaultSort: 'chargedDayCount',
    defaultDirection: 'DESC',
    sortFields: ['chargedDayCount', 'userName'],
    columns: [
      { key: 'userName', labelKey: 'columns.userName' },
      { key: 'workforceGroupName', labelKey: 'columns.workforceGroup' },
      { key: 'leaveTypeName', labelKey: 'columns.leaveType' },
      { key: 'presence', labelKey: 'columns.presence' },
      { key: 'membershipBasis', labelKey: 'columns.membershipBasis' },
      { key: 'requestCount', labelKey: 'columns.requests' },
      { key: 'chargedDayCount', labelKey: 'columns.chargedDays' },
    ],
    summaryFields: [
      { key: 'requestCount', labelKey: 'summary.requests' },
      { key: 'chargedDayCount', labelKey: 'summary.chargedDays' },
      { key: 'excludedReconstructedRequestCount', labelKey: 'summary.excludedReconstructed' },
      { key: 'excludedUnknownRequestCount', labelKey: 'summary.excludedUnknown' },
      { key: 'requestCountsByPresence', labelKey: 'summary.requestsByPresence' },
      { key: 'chargedDayCountsByPresence', labelKey: 'summary.chargedDaysByPresence' },
    ],
  },
  {
    key: 'REQUEST_DETAIL',
    labelKey: 'definitions.requestDetail.label',
    descriptionKey: 'definitions.requestDetail.description',
    filters: [
      'dateRange',
      'workforceGroup',
      'leaveType',
      'status',
      'includeInactiveUsers',
    ],
    defaultSort: 'dateFrom',
    defaultDirection: 'DESC',
    sortFields: ['dateFrom', 'status', 'userName'],
    columns: [
      { key: 'requestId', labelKey: 'columns.requestId' },
      { key: 'userName', labelKey: 'columns.userName' },
      { key: 'workforceGroupName', labelKey: 'columns.workforceGroup' },
      { key: 'leaveTypeName', labelKey: 'columns.leaveType' },
      { key: 'dateFrom', labelKey: 'columns.from' },
      { key: 'dateTo', labelKey: 'columns.to' },
      { key: 'storedDays', labelKey: 'columns.storedDays' },
      { key: 'status', labelKey: 'columns.status' },
      { key: 'submittedAt', labelKey: 'columns.submittedAt' },
      { key: 'decidedAt', labelKey: 'columns.decidedAt' },
      { key: 'currentApprovalStageCode', labelKey: 'columns.approvalStage' },
    ],
    summaryFields: [
      { key: 'rowCount', labelKey: 'summary.requests' },
      { key: 'storedDayCount', labelKey: 'summary.storedDays' },
      { key: 'statusCounts', labelKey: 'summary.statusCounts' },
      { key: 'storedDayCountsByStatus', labelKey: 'summary.storedDaysByStatus' },
    ],
  },
  {
    key: 'EXCEPTION',
    labelKey: 'definitions.exception.label',
    descriptionKey: 'definitions.exception.description',
    filters: [
      'workforceGroup',
      'leaveType',
      'exceptionCode',
      'includeInactiveUsers',
    ],
    defaultSort: 'severity',
    defaultDirection: 'ASC',
    sortFields: ['severity', 'code'],
    columns: [
      { key: 'severity', labelKey: 'columns.severity' },
      { key: 'code', labelKey: 'columns.code' },
      { key: 'subjectLabel', labelKey: 'columns.subject' },
      { key: 'subjectType', labelKey: 'columns.subjectType' },
      { key: 'detectedAsOf', labelKey: 'columns.detectedAsOf' },
      { key: 'facts', labelKey: 'columns.facts' },
    ],
    summaryFields: [
      { key: 'rowCount', labelKey: 'summary.exceptions' },
      { key: 'codeCounts', labelKey: 'summary.codeCounts' },
      { key: 'severityCounts', labelKey: 'summary.severityCounts' },
    ],
  },
  {
    key: 'PENDING_AGING',
    labelKey: 'definitions.pendingAging.label',
    descriptionKey: 'definitions.pendingAging.description',
    filters: ['workforceGroup', 'leaveType'],
    defaultSort: 'ageDays',
    defaultDirection: 'DESC',
    sortFields: ['ageDays', 'submittedAt'],
    columns: [
      { key: 'requestId', labelKey: 'columns.requestId' },
      { key: 'userName', labelKey: 'columns.userName' },
      { key: 'workforceGroupName', labelKey: 'columns.workforceGroup' },
      { key: 'leaveTypeName', labelKey: 'columns.leaveType' },
      { key: 'dateFrom', labelKey: 'columns.from' },
      { key: 'dateTo', labelKey: 'columns.to' },
      { key: 'currentApprovalStageCode', labelKey: 'columns.approvalStage' },
      { key: 'submittedAt', labelKey: 'columns.submittedAt' },
      { key: 'activatedAt', labelKey: 'columns.activatedAt' },
      { key: 'ageDays', labelKey: 'columns.ageDays' },
      { key: 'activationProvenance', labelKey: 'columns.activationProvenance' },
      { key: 'bucket', labelKey: 'columns.bucket' },
    ],
    summaryFields: [
      { key: 'rowCount', labelKey: 'summary.requests' },
      { key: 'oldestAgeDays', labelKey: 'summary.oldestAgeDays' },
      { key: 'bucketCounts', labelKey: 'summary.bucketCounts' },
      { key: 'provenanceCounts', labelKey: 'summary.provenanceCounts' },
    ],
  },
  {
    // Plan RESTO: one row per person x leave type for a balance year.
    key: 'CARRYOVER',
    labelKey: 'definitions.carryover.label',
    descriptionKey: 'definitions.carryover.description',
    filters: ['balanceYear', 'workforceGroup', 'leaveType', 'status', 'includeInactiveUsers'],
    defaultSort: 'userName',
    defaultDirection: 'ASC',
    sortFields: ['userName', 'carriedDays', 'availableDays'],
    columns: [
      { key: 'userName', labelKey: 'columns.userName' },
      { key: 'workforceGroupName', labelKey: 'columns.workforceGroup' },
      { key: 'leaveTypeName', labelKey: 'columns.leaveType' },
      { key: 'sourceYear', labelKey: 'columns.sourceYear' },
      { key: 'capDays', labelKey: 'columns.capDays' },
      { key: 'carriedDays', labelKey: 'columns.carriedDays' },
      { key: 'usedDays', labelKey: 'columns.usedDays' },
      { key: 'pendingClaimDays', labelKey: 'columns.pendingClaimDays' },
      { key: 'expiredDays', labelKey: 'columns.expiredDays' },
      { key: 'availableDays', labelKey: 'columns.availableDays' },
      { key: 'expiresOn', labelKey: 'columns.expiresOn' },
      { key: 'status', labelKey: 'columns.status' },
    ],
    summaryFields: [
      { key: 'userCount', labelKey: 'summary.users' },
      { key: 'totalCarried', labelKey: 'summary.totalCarried' },
      { key: 'totalUsed', labelKey: 'summary.totalUsed' },
      { key: 'totalPendingClaim', labelKey: 'summary.totalPendingClaim' },
      { key: 'totalExpired', labelKey: 'summary.totalExpired' },
      { key: 'totalAvailable', labelKey: 'summary.totalAvailable' },
      { key: 'rowsByStatus', labelKey: 'summary.rowsByStatus' },
    ],
    statusOptions: ['ACTIVE', 'EXPIRED', 'NONE'],
  },
] as const

// Partial on purpose: ReportDefinitionKey is hand-declared in api/client.ts, so a key
// can exist in the union with no entry here. Typing this as a total Record would make
// every lookup type as present and throw on `.filters` at runtime instead.
export const REPORT_DEFINITION_BY_KEY = Object.fromEntries(
  REPORT_DEFINITIONS.map((definition) => [definition.key, definition]),
) as Partial<Record<ReportDefinitionKey, ReportDefinition>>

export const DEFAULT_REPORT_DEFINITION = REPORT_DEFINITIONS[0]

/** Never returns undefined: an unknown key falls back to the first definition. */
export function reportDefinitionFor(key: string | undefined): ReportDefinition {
  if (!key) return DEFAULT_REPORT_DEFINITION
  return REPORT_DEFINITION_BY_KEY[key as ReportDefinitionKey] ?? DEFAULT_REPORT_DEFINITION
}

/**
 * The URL segment for each report, so /reports/carry-over reads as a page rather than
 * leaking the wire enum into the address bar. Hand-maintained beside the definitions
 * rather than derived from the key: a slug is a URL contract, and deriving it would let
 * a rename of the enum silently break every saved link.
 */
export const REPORT_SLUG_BY_KEY: Record<ReportDefinitionKey, string> = {
  BALANCE_SNAPSHOT: 'balance-snapshot',
  LEAVE_USAGE: 'leave-usage',
  REQUEST_DETAIL: 'request-detail',
  EXCEPTION: 'exceptions',
  PENDING_AGING: 'pending-aging',
  CARRYOVER: 'carry-over',
}

const REPORT_KEY_BY_SLUG = Object.fromEntries(
  Object.entries(REPORT_SLUG_BY_KEY).map(([key, slug]) => [slug, key]),
) as Record<string, ReportDefinitionKey | undefined>

export function reportSlugFor(key: ReportDefinitionKey): string {
  return REPORT_SLUG_BY_KEY[key]
}

/**
 * Deliberately NOT `reportDefinitionFor`'s forgiving lookup: that one falls back to Balance
 * Snapshot for any unknown key, which is right for a stored value but wrong for a URL. A
 * mistyped /reports/<slug> must be answerable as "no such report", so this returns undefined
 * and lets the caller decide.
 */
export function reportKeyForSlug(slug: string | undefined): ReportDefinitionKey | undefined {
  if (!slug) return undefined
  return REPORT_KEY_BY_SLUG[slug]
}

export const REPORT_STATUS_OPTIONS = ['PENDING', 'APPROVED', 'DECLINED'] as const

export function statusOptionsFor(definition: ReportDefinition): readonly string[] {
  return definition.statusOptions ?? REPORT_STATUS_OPTIONS
}

/** Years the balance-year filter offers, newest first; the server accepts 2000-2100. */
export function balanceYearOptions(now: Date = new Date()): number[] {
  // UTC because the server keys balances on the UTC year.
  const current = now.getUTCFullYear()
  return [current + 1, current, current - 1, current - 2, current - 3]
}

export const REPORT_EXCEPTION_OPTIONS = [
  'NEGATIVE_REMAINING',
  'CAPPED_TYPE_WITHOUT_ENTITLEMENT',
  'USER_WITHOUT_WORKFORCE_GROUP',
  'STALE_PENDING',
] as const
