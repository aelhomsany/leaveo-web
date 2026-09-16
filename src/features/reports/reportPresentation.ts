import type { ReportDefinitionKey } from '../../api/client'

/** Presentation order only. Values, totals and ordering still come from the reporting API. */
export const REPORT_PRIMARY_SUMMARIES: Record<ReportDefinitionKey, readonly string[]> = {
  BALANCE_SNAPSHOT: ['userCount', 'totalAllocation', 'totalApprovedUsage', 'totalRemaining'],
  LEAVE_USAGE: ['requestCount', 'chargedDayCount'],
  REQUEST_DETAIL: ['rowCount', 'storedDayCount'],
  EXCEPTION: ['rowCount'],
  PENDING_AGING: ['rowCount', 'oldestAgeDays'],
  CARRYOVER: ['userCount', 'totalCarried', 'totalUsed', 'totalAvailable'],
}

/** Other columns remain available in each row's disclosure; no response fields are discarded. */
export const REPORT_PRIMARY_COLUMNS: Record<ReportDefinitionKey, readonly string[]> = {
  BALANCE_SNAPSHOT: ['userName', 'leaveTypeName', 'allocation', 'approvedUsage', 'remaining', 'carryoverAvailable'],
  LEAVE_USAGE: ['userName', 'leaveTypeName', 'presence', 'requestCount', 'chargedDayCount'],
  REQUEST_DETAIL: ['userName', 'leaveTypeName', 'dateFrom', 'dateTo', 'storedDays', 'status'],
  EXCEPTION: ['subjectLabel', 'severity', 'code', 'detectedAsOf'],
  PENDING_AGING: ['userName', 'leaveTypeName', 'currentApprovalStageCode', 'ageDays', 'bucket'],
  CARRYOVER: ['userName', 'leaveTypeName', 'carriedDays', 'usedDays', 'pendingClaimDays', 'expiredDays', 'availableDays', 'status'],
}
