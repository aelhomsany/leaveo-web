// Shared fixture helpers for tests.
import type {
  ApprovalStepEvidenceResponse,
  LeaveCancellationCapability,
  LeaveRequestResponse,
  LeaveTypePolicySummary,
  PendingApprovalResponse,
  PreviewLeaveRequestResponse,
  RecentApprovalDecisionResponse,
  RecentRequestResponse,
  TeamMemberDetailResponse,
  TeamMemberSummaryResponse,
  WorkforceGroupResponse,
} from '../api/generated/types'

/** A realistic "nothing to restore, no cancellation in flight" capability. */
export function noCancellation(
  overrides: Partial<LeaveCancellationCapability> = {},
): LeaveCancellationCapability {
  return {
    cancellable: false,
    mode: 'NONE',
    daysToRestore: 0,
    daysForfeited: 0,
    blockedReason: null,
    reviewStatus: null,
    ...overrides,
  }
}

/** A realistic LeaveRequestResponse: approved by user 1, in person, with the balance charged. */
export function mockLeaveRequestResponse(
  overrides: Partial<LeaveRequestResponse> = {},
): LeaveRequestResponse {
  return {
    id: 101,
    leaveTypeId: 1,
    dateFrom: '2026-06-15',
    dateTo: '2026-06-17',
    days: 2,
    startPart: 'FULL',
    endPart: 'FULL',
    status: 'APPROVED',
    note: null,
    createdAt: '2026-06-10T09:00:00Z',
    approvedById: 1,
    declinedById: null,
    declineReason: null,
    balanceApplied: true,
    // LeaveDecisionMapper sets these two only when the approver acted on someone's behalf.
    decidedOnBehalf: null,
    nominalApproverFirstName: null,
    cancellation: noCancellation(),
    ...overrides,
  }
}

/** A realistic single-level approval step, fully recorded (approved, not on anyone's behalf). */
export function mockApprovalStepEvidence(
  overrides: Partial<ApprovalStepEvidenceResponse> = {},
): ApprovalStepEvidenceResponse {
  return {
    level: 1,
    nominalApproverId: 1,
    nominalApproverFullName: 'Approver One',
    actualActorId: 1,
    actualActorFullName: 'Approver One',
    status: 'APPROVED',
    result: 'APPROVED',
    note: null,
    decidedAt: '2026-06-01T10:00:00Z',
    current: false,
    actedOnBehalf: false,
    ...overrides,
  }
}

/**
 * A realistic GET /my-leave-requests row: an approved own-history card with a real (non-null)
 * cancellation capability, since this endpoint only ever returns the viewer's own requests.
 */
export function mockRecentRequestResponse(
  overrides: Partial<RecentRequestResponse> = {},
): RecentRequestResponse {
  return {
    id: 1,
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-06-15',
    dateTo: '2026-06-17',
    workingDays: 2,
    status: 'APPROVED',
    statusHint: null,
    declineReason: null,
    approverFirstName: null,
    cancellation: noCancellation(),
    ...overrides,
  }
}

/** A realistic active team member row, no manager assigned, never deactivated. */
export function mockTeamMemberSummary(
  overrides: Partial<TeamMemberSummaryResponse> = {},
): TeamMemberSummaryResponse {
  return {
    id: 1,
    publicId: 'tm-1',
    fullName: 'Team Member',
    email: 'member@example.com',
    department: 'General',
    role: 'EMPLOYEE',
    workforceGroupId: 1,
    workforceGroupName: 'Default',
    managerId: null,
    managerName: null,
    status: 'ACTIVE',
    deactivatedAt: null,
    ...overrides,
  }
}

/** A realistic active team member detail, no manager, no entitlements, no approval chain. */
export function mockTeamMemberDetail(
  overrides: Partial<TeamMemberDetailResponse> = {},
): TeamMemberDetailResponse {
  return {
    id: 1,
    fullName: 'Team Member',
    email: 'member@example.com',
    department: 'General',
    role: 'EMPLOYEE',
    workforceGroupId: 1,
    workforceGroupName: 'Default',
    managerId: null,
    managerName: null,
    status: 'ACTIVE',
    deactivatedAt: null,
    entitlements: [],
    approvalChain: [],
    ...overrides,
  }
}

/**
 * A realistic leave-type row from GET /settings/leave-policies/overview: a policy exists, no draft
 * is in flight. Every field is on the wire in every row (PolicySettingsOverviewService reads one
 * fixed-column SQL row per leave type), so a sparse literal at a call site is a fixture bug.
 */
export function mockLeaveTypePolicySummary(
  overrides: Partial<LeaveTypePolicySummary> = {},
): LeaveTypePolicySummary {
  return {
    leaveTypePublicId: 'lt-1',
    name: 'Annual Leave',
    icon: '🏖️',
    color: '#093C5D',
    backgroundColor: '#D6E8ED',
    borderColor: '#0E4F75',
    presenceType: 'OFF',
    defaultBalanceDays: 20,
    displayOrder: 1,
    active: true,
    policyPublicId: 'policy-1',
    latestDraft: null,
    ...overrides,
  }
}

/** A realistic approved decision on someone else's leave request, as returned by
 * GET /dashboard/recent-approval-decisions. Used wherever a test only cares about a subset of
 * fields (who/what/when), not the full row. */
export function mockRecentApprovalDecision(
  overrides: Partial<RecentApprovalDecisionResponse> = {},
): RecentApprovalDecisionResponse {
  return {
    requestId: 501,
    employeeUserId: 2,
    employeeFullName: 'Sarah Chen',
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-02',
    workingDays: 2,
    status: 'APPROVED',
    decisionResult: 'APPROVED',
    actorFirstName: 'Alex',
    decidedAt: '2026-06-03T10:00:00Z',
    decidedOnBehalf: false,
    nominalApproverFirstName: null,
    ...overrides,
  }
}

/**
 * A realistic POST /leave-requests/preview response: a 5-working-day annual-allowance charge,
 * no carryover involved. Used wherever a test only drives the modal to a submittable state and
 * doesn't assert on the specific preview numbers (RequestLeaveModal's own tests build payload-
 * derived previews instead, since they DO assert on the numbers).
 */
export function mockPreviewLeaveRequestResponse(
  overrides: Partial<PreviewLeaveRequestResponse> = {},
): PreviewLeaveRequestResponse {
  return {
    workingDays: 5,
    excludedWeekends: 2,
    excludedHolidays: 0,
    workforceGroupId: 1,
    workforceGroupName: 'US',
    policyVersionPublicId: 'policy-version-1',
    policyAssignmentPublicId: 'policy-assignment-1',
    allowanceMode: 'ANNUAL_ALLOWANCE',
    allowanceDays: 20,
    chargedDates: [],
    chargedDays: 5,
    chargedDayParts: [],
    ...overrides,
  }
}

/**
 * A realistic pending leave request queued for approval, as returned by GET
 * /approvals/pending: no overlapping absences, a first-level approval, no carryover involved.
 */
export function mockPendingApprovalResponse(
  overrides: Partial<PendingApprovalResponse> = {},
): PendingApprovalResponse {
  return {
    requestId: 101,
    employeeUserId: 7,
    employeeFullName: 'Sarah Chen',
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    leaveTypeIcon: 'leave',
    leaveTypeColor: '#093C5D',
    leaveTypeBackgroundColor: '#D6E8ED',
    leaveTypeBorderColor: '#0E4F75',
    dateFrom: '2026-06-15',
    dateTo: '2026-06-17',
    workingDays: 2,
    note: 'Family trip',
    workforceGroupName: 'US',
    overlappingApprovedAbsences: 0,
    approvalLevel: 1,
    decidedOnBehalf: false,
    nominalApproverFirstName: null,
    balanceCarryoverAvailable: null,
    carryoverDaysToUse: null,
    carryoverExpiresOn: null,
    ...overrides,
  }
}

/** A realistic workforce group, Saturday/Sunday weekend, no scheduled changes or overrides. */
export function mockWorkforceGroup(
  overrides: Partial<WorkforceGroupResponse> = {},
): WorkforceGroupResponse {
  return {
    id: 1,
    name: 'US',
    timezone: 'America/New_York',
    weekendDays: ['SATURDAY', 'SUNDAY'],
    currentEffectiveFrom: '2026-01-01',
    scheduledChanges: [],
    overrideCount: 0,
    ...overrides,
  }
}
