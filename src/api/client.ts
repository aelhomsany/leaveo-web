import type {
  AcceptInvitationRequest,
  BalanceCardResponse,
  OutTodayResponse,
  RecentRequestResponse,
  UpcomingAbsenceResponse,
  CreateLeaveRequestRequest,
  CreatePublicHolidayRequest,
  CreateTeamMemberRequest,
  CreateWorkforceGroupRequest,
  DayOfWeek,
  ForgotPasswordRequest,
  LeaveRequestResponse,
  LeaveRequestContextResponse,
  DeclineLeaveRequestRequest,
  CancelLeaveRequestRequest,
  RequestLeaveCancellationRequest,
  ApproveLeaveCancellationRequest,
  DeclineLeaveCancellationRequest,
  CancellationRequestResponse,
  PendingCancellationResponse,
  LeaveTypeResponse,
  LoginRequest,
  PendingApprovalResponse,
  PendingApprovalCountResponse,
  NotificationResponse,
  UnreadCountResponse,
  MarkAllReadResponse,
  PreviewLeaveRequestRequest,
  PreviewLeaveRequestResponse,
  ProblemDetail,
  PublicHolidayResponse,
  RecentApprovalDecisionResponse,
  AuditEventResponse,
  ResetPasswordRequest,
  TeamMemberDetailResponse,
  TeamMemberInvitationResponse,
  TeamMemberSummaryResponse,
  TokenResponse,
  UpdatePublicHolidayRequest,
  UpdateTeamMemberRequest,
  UpdateTeamMemberStatusRequest,
  UpdateWeekendDaysRequest,
  UpdateWorkforceGroupRequest,
  WorkingWeekOverridePreviewResponse,
  WorkingWeekOverrideRequest,
  WorkingWeekOverrideResponse,
  WorkingWeekOverrideResult,
  UserSummaryResponse,
  WorkforceGroupResponse,
  CalendarMonthResponse,
  CalendarSyncConnectResponse,
  CalendarSyncStatusResponse,
  CalendarFeedLinkResponse,
  CalendarFeedStatusResponse,
  ChatWebhookResponse,
  SlackInstallResponse,
  SlackLinkResponse,
  SlackStatusResponse,
  ChatWebhookUpsertRequest,
  NotificationPreferenceResponse,
  UpdateNotificationPreferenceRequest,
  CheckoutSessionResponse,
  CreateOrganizationRequest,
  CreateCheckoutSessionRequest,
  OrganizationSummaryResponse,
  UpdateSubscriptionRequest,
  UpdateUserPreferencesRequest,
  RecordApprovalConcernRequest,
  ApprovalCapabilityResponse,
  ReportQueryRequest,
  ReportQueryResponse,
  CreateReportExportRequest,
  ReportExportResponse,
  CreateLeaveTypeRequest,
  UpdateLeaveTypeRequest,
  CreatePolicyDraftRequest,
  UpdatePolicyDraftRequest,
  PolicyDraftResponse,
  PublishPolicyRequest,
  PolicyPreviewResponse,
  PolicyPublicationResponse,
  PolicyHistoryItem,
  PolicySettingsOverviewResponse,
  CreateImportJobRequest,
  ImportJobResponse,
  ImportJobListPage,
  ImportRowResultPage,
  RecordBalanceCorrectionRequest,
  PreviewBalanceCorrectionRequest,
  BalanceCorrectionPreviewResponse,
  BalanceCorrectionResponse,
  CompensateBalanceCorrectionRequest,
  BalanceCorrectionListPage,
  BalanceCorrectionListItemResponse,
  CalendarPrivacyVersionResponse,
  CalendarPrivacyPreviewResponse,
  PublishCalendarPrivacyRequest,
} from './generated/types'
import type { components } from './generated/types'
import { clearAccessToken, getAccessToken, setAccessToken } from '../auth/tokenStorage'
import { parseFieldViolations, type FieldViolationMap } from './fieldViolations'

/** Prefer relative /api paths so Vite dev proxy forwards cookies (refresh token). */
const configuredBaseUrl = import.meta.env.VITE_API_URL ?? ''
export const baseUrl =
  configuredBaseUrl === 'http://localhost:8080' ? '' : configuredBaseUrl

export type OnboardingStageId =
  | 'ORGANIZATION'
  | 'WORKING_CALENDARS'
  | 'PEOPLE_AND_INVITATIONS'
  | 'ENTITLEMENTS_AND_READINESS'
  | 'FIRST_LEAVE_CYCLE'

export type ReportDefinitionKey =
  | 'BALANCE_SNAPSHOT'
  | 'LEAVE_USAGE'
  | 'REQUEST_DETAIL'
  | 'EXCEPTION'
  | 'PENDING_AGING'
  | 'CARRYOVER'

// Optionality mirrors `components["schemas"]["OnboardingResponse"]` in api/generated/types.ts.
// Declaring these as required here while the generated contract marks them optional meant
// TypeScript could not catch a partial response, and `state.nextSafeAction.href` threw at runtime.
export type OnboardingState = {
  workflowVersion?: string
  stages?: Array<{ id: OnboardingStageId; label: string }>
  evidence?: Partial<Record<OnboardingStageId, {
    complete: boolean
    summary?: string
    facts?: Record<string, unknown>
  }>>
  currentPresentationStep?: OnboardingStageId
  nextSafeAction?: { stage: OnboardingStageId; action?: string; href: string }
  version?: number
  activationStatus: 'NOT_ACTIVATED' | 'COMMERCIALLY_ACTIVATED'
  milestones?: {
    invitationAccepted: boolean
    firstRequestSubmitted: boolean
    firstRequestApproved: boolean
    reconciled: boolean
  }
  workspaceCreated: boolean
  onboardingComplete?: boolean
  billingInOnboarding?: boolean
  plan?: string
  creationSource?: 'SELF_SERVICE' | 'PLATFORM_ADMIN'
  presentationEnabled?: boolean
  fallbackRoute?: string
  analyticsConsent?: 'NECESSARY_ONLY' | 'OPTIONAL_ANALYTICS'
  conflict?: {
    message: string
    recoverableInput?: Record<string, string>
  }
}

let authFailureHandler: (() => void) | null = null
let refreshPromise: Promise<TokenResponse> | null = null

export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler
}

export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetail
  readonly fieldViolations: FieldViolationMap | null

  constructor(status: number, problem: ProblemDetail) {
    super(problem.detail ?? problem.title ?? 'Request failed')
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
    this.fieldViolations = parseFieldViolations(problem)
  }
}

function resolveUrl(path: string): string {
  if (path.startsWith('http')) {
    return path
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${normalizedPath}`
}

function createCorrelationId(): string {
  return crypto.randomUUID()
}

async function parseProblemDetail(response: Response): Promise<ProblemDetail> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/problem+json') || contentType.includes('application/json')) {
    try {
      return (await response.json()) as ProblemDetail
    } catch {
      // fall through
    }
  }
  return {
    status: response.status,
    title: response.statusText,
    detail: response.statusText || 'Request failed',
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
  skipAuthRefresh?: boolean
  _retried?: boolean
  responseType?: 'blob'
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuthRefresh, _retried, responseType, headers: customHeaders, ...init } = options
  const headers = new Headers(customHeaders)
  headers.set('X-Correlation-Id', createCorrelationId())

  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getAccessToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(resolveUrl(path), {
    ...init,
    headers,
    credentials: 'include',
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  })

  if (
    response.status === 401 &&
    !skipAuthRefresh &&
    !_retried &&
    !path.includes('/auth/login') &&
    !path.includes('/auth/refresh')
  ) {
    try {
      await refreshAccessToken()
      return request<T>(path, { ...options, _retried: true })
    } catch {
      authFailureHandler?.()
      throw new ApiError(401, {
        status: 401,
        detail: 'Session expired',
        title: 'Unauthorized',
      })
    }
  }

  if (response.status === 204) {
    return undefined as T
  }

  if (!response.ok) {
    const problem = await parseProblemDetail(response)
    throw new ApiError(response.status, problem)
  }

  if (response.headers.get('content-length') === '0') {
    return undefined as T
  }

  if (responseType === 'blob') {
    return (await response.blob()) as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    return undefined as T
  }

  return (await response.json()) as T
}

async function refreshAccessToken(): Promise<TokenResponse> {
  if (!refreshPromise) {
    refreshPromise = postRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function postLogin(credentials: LoginRequest): Promise<TokenResponse> {
  const tokens = await request<TokenResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: credentials,
    skipAuthRefresh: true,
  })
  setAccessToken(tokens.accessToken)
  return tokens
}

export async function postRefresh(): Promise<TokenResponse> {
  const tokens = await request<TokenResponse>('/api/v1/auth/refresh', {
    method: 'POST',
    body: {},
    skipAuthRefresh: true,
  })
  setAccessToken(tokens.accessToken)
  return tokens
}

export async function postLogout(): Promise<void> {
  await request<void>('/api/v1/auth/logout', {
    method: 'POST',
    body: {},
    skipAuthRefresh: true,
  })
  clearAccessToken()
}

export async function getMe(): Promise<UserSummaryResponse> {
  return request<UserSummaryResponse>('/api/v1/auth/me', {
    method: 'GET',
  })
}

export async function getOnboarding(): Promise<OnboardingState> {
  return request<OnboardingState>('/api/v1/onboarding', { method: 'GET' })
}

export async function updateOnboardingPresentation(
  version: number,
  presentationStep: OnboardingStageId,
): Promise<OnboardingState> {
  return request<OnboardingState>('/api/v1/onboarding/presentation', {
    method: 'PATCH',
    body: { version, presentationStep },
  })
}

export async function uploadProfileImage(file: File): Promise<UserSummaryResponse> {
  const formData = new FormData()
  formData.append('file', file)
  return request<UserSummaryResponse>('/api/v1/users/me/profile-image', {
    method: 'POST',
    body: formData,
  })
}

export async function removeProfileImage(): Promise<void> {
  await request<void>('/api/v1/users/me/profile-image', {
    method: 'DELETE',
  })
}

export async function getProfileImageContent(profileImageUrl: string): Promise<Blob> {
  return request<Blob>(profileImageUrl, {
    method: 'GET',
    responseType: 'blob',
  })
}

export async function postForgotPassword(payload: ForgotPasswordRequest): Promise<void> {
  await request<void>('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: payload,
    skipAuthRefresh: true,
  })
}

export async function postResetPassword(payload: ResetPasswordRequest): Promise<void> {
  await request<void>('/api/v1/auth/reset-password', {
    method: 'POST',
    body: payload,
    skipAuthRefresh: true,
  })
}

export async function postAcceptInvitation(
  payload: AcceptInvitationRequest,
): Promise<TeamMemberDetailResponse> {
  return request<TeamMemberDetailResponse>('/api/v1/auth/accept-invitation', {
    method: 'POST',
    body: payload,
    skipAuthRefresh: true,
  })
}

export async function getWorkforceGroups(): Promise<WorkforceGroupResponse[]> {
  return request<WorkforceGroupResponse[]>('/api/v1/workforce-groups', {
    method: 'GET',
  })
}

export async function createWorkforceGroup(
  payload: CreateWorkforceGroupRequest,
): Promise<WorkforceGroupResponse> {
  return request<WorkforceGroupResponse>('/api/v1/workforce-groups', {
    method: 'POST',
    body: payload,
  })
}

export async function patchWorkforceGroup(
  groupId: number,
  payload: UpdateWorkforceGroupRequest,
): Promise<WorkforceGroupResponse> {
  return request<WorkforceGroupResponse>(`/api/v1/workforce-groups/${groupId}`, {
    method: 'PATCH',
    body: payload,
  })
}

/**
 * Sets the group's working week from a date. Without `effectiveFrom` the server applies it from
 * today in the group's time zone; a later date is added as a scheduled change instead.
 */
export async function putWorkforceGroupWeekendDays(
  groupId: number,
  weekendDays: DayOfWeek[],
  effectiveFrom?: string,
): Promise<WorkforceGroupResponse> {
  const payload: UpdateWeekendDaysRequest = effectiveFrom
    ? { weekendDays, effectiveFrom }
    : { weekendDays }
  return request<WorkforceGroupResponse>(
    `/api/v1/workforce-groups/${groupId}/weekend-days`,
    {
      method: 'PUT',
      body: payload,
    },
  )
}

export async function cancelScheduledWeekendChange(
  groupId: number,
  versionPublicId: string,
): Promise<WorkforceGroupResponse> {
  return request<WorkforceGroupResponse>(
    `/api/v1/workforce-groups/${groupId}/weekend-days/${encodeURIComponent(versionPublicId)}`,
    { method: 'DELETE' },
  )
}

// Plan UNO: per-person working weeks. Writes are gated by DISTRIBUTED_OPERATIONS server-side.
export async function listWorkingWeekOverrides(): Promise<WorkingWeekOverrideResponse[]> {
  return request<WorkingWeekOverrideResponse[]>('/api/v1/settings/working-week-overrides', {
    method: 'GET',
  })
}

export async function previewWorkingWeekOverride(
  payload: WorkingWeekOverrideRequest,
): Promise<WorkingWeekOverridePreviewResponse> {
  return request<WorkingWeekOverridePreviewResponse>(
    '/api/v1/settings/working-week-overrides/preview',
    { method: 'POST', body: payload },
  )
}

export async function commitWorkingWeekOverride(
  idempotencyKey: string,
  payload: WorkingWeekOverrideRequest,
): Promise<WorkingWeekOverrideResult> {
  return request<WorkingWeekOverrideResult>('/api/v1/settings/working-week-overrides', {
    method: 'POST',
    body: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}

export async function removeWorkingWeekOverride(versionPublicId: string): Promise<void> {
  return request<void>(
    `/api/v1/settings/working-week-overrides/${encodeURIComponent(versionPublicId)}`,
    { method: 'DELETE' },
  )
}

export async function getPublicHolidays(
  workforceGroupId: number,
): Promise<PublicHolidayResponse[]> {
  return request<PublicHolidayResponse[]>(
    `/api/v1/public-holidays?workforceGroupId=${workforceGroupId}`,
    { method: 'GET' },
  )
}

export async function createPublicHoliday(
  payload: CreatePublicHolidayRequest,
): Promise<PublicHolidayResponse> {
  return request<PublicHolidayResponse>('/api/v1/public-holidays', {
    method: 'POST',
    body: payload,
  })
}

export async function updatePublicHoliday(
  id: number,
  payload: UpdatePublicHolidayRequest,
): Promise<PublicHolidayResponse> {
  return request<PublicHolidayResponse>(`/api/v1/public-holidays/${id}`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function deletePublicHoliday(id: number): Promise<void> {
  return request<void>(`/api/v1/public-holidays/${id}`, {
    method: 'DELETE',
  })
}

export async function getLeaveTypes(): Promise<LeaveTypeResponse[]> {
  return request<LeaveTypeResponse[]>('/api/v1/leave-types', {
    method: 'GET',
  })
}

export type PolicySettingsOverview = PolicySettingsOverviewResponse

export const getManagedLeaveTypes = () => request<LeaveTypeResponse[]>('/api/v1/settings/leave-types', { method: 'GET' })
export const createLeaveType = (payload: CreateLeaveTypeRequest) => request<LeaveTypeResponse>('/api/v1/settings/leave-types', { method: 'POST', body: payload })
export const updateLeaveType = (publicId: string, payload: UpdateLeaveTypeRequest) => request<LeaveTypeResponse>(`/api/v1/settings/leave-types/${publicId}`, { method: 'PATCH', body: payload })
export const deactivateLeaveType = (publicId: string) => request<LeaveTypeResponse>(`/api/v1/settings/leave-types/${publicId}/deactivate`, { method: 'POST' })
export const reactivateLeaveType = (publicId: string) => request<LeaveTypeResponse>(`/api/v1/settings/leave-types/${publicId}/reactivate`, { method: 'POST' })
export const reorderLeaveTypes = (publicIds: string[]) => request<LeaveTypeResponse[]>('/api/v1/settings/leave-types/reorder', { method: 'POST', body: { publicIds } })
export const getPolicySettingsOverview = () => request<PolicySettingsOverview>('/api/v1/settings/leave-policies/overview', { method: 'GET' })
export const createPolicyDraft = (payload: CreatePolicyDraftRequest) => request<PolicyDraftResponse>('/api/v1/settings/leave-policies/drafts', { method: 'POST', body: payload })
export const getPolicyDraft = (publicId: string) => request<PolicyDraftResponse>(`/api/v1/settings/leave-policies/drafts/${publicId}`, { method: 'GET' })
export const updatePolicyDraft = (publicId: string, payload: UpdatePolicyDraftRequest) => request<PolicyDraftResponse>(`/api/v1/settings/leave-policies/drafts/${publicId}`, { method: 'PATCH', body: payload })
export const previewPolicy = (publicId: string) => request<PolicyPreviewResponse>(`/api/v1/settings/leave-policies/drafts/${publicId}/preview`, { method: 'POST' })
export const publishPolicy = (publicId: string, idempotencyKey: string, payload: PublishPolicyRequest) => request<PolicyPublicationResponse>(`/api/v1/settings/leave-policies/drafts/${publicId}/publish`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: payload })
export const getPolicyHistory = (policyPublicId: string) => request<PolicyHistoryItem[]>(`/api/v1/settings/leave-policies/${policyPublicId}/history`, { method: 'GET' })

// Story 16.2 — calendar visibility configuration (HR only).
export const getCalendarPrivacy = () => request<CalendarPrivacyVersionResponse>('/api/v1/settings/calendar-privacy', { method: 'GET' })
export const previewCalendarPrivacy = (payload: PublishCalendarPrivacyRequest) => request<CalendarPrivacyPreviewResponse>('/api/v1/settings/calendar-privacy/preview', { method: 'POST', body: payload })
export const publishCalendarPrivacy = (payload: PublishCalendarPrivacyRequest) => request<CalendarPrivacyVersionResponse>('/api/v1/settings/calendar-privacy', { method: 'POST', body: payload })

export type ImportTemplateKey = 'PEOPLE_AND_ASSIGNMENTS' | 'ENTITLEMENTS_AND_OPENING_BALANCES'

export async function createImportJob(
  idempotencyKey: string,
  templateKey: ImportTemplateKey,
): Promise<ImportJobResponse> {
  const request_: CreateImportJobRequest = { templateKey }
  return request<ImportJobResponse>('/api/v1/imports', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: request_,
  })
}

export async function uploadImportSource(publicId: string, file: File): Promise<ImportJobResponse> {
  const formData = new FormData()
  formData.append('file', file)
  return request<ImportJobResponse>(`/api/v1/imports/${publicId}/upload`, {
    method: 'POST',
    body: formData,
  })
}

export async function getImportJob(publicId: string): Promise<ImportJobResponse> {
  return request<ImportJobResponse>(`/api/v1/imports/${publicId}`, { method: 'GET' })
}

/** Newest-first, optionally filtered by lifecycle status. Mirrors `listReportExports`'s shape. */
export async function listImportJobs(
  status?: string,
  page = 0,
  size = 20,
): Promise<ImportJobListPage> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (status) params.set('status', status)
  return request<ImportJobListPage>(`/api/v1/imports?${params.toString()}`, { method: 'GET' })
}

export async function getImportRows(
  publicId: string,
  page = 0,
  size = 100,
): Promise<ImportRowResultPage> {
  return request<ImportRowResultPage>(
    `/api/v1/imports/${publicId}/rows?page=${page}&size=${size}`,
    { method: 'GET' },
  )
}

export async function commitImportJob(publicId: string): Promise<ImportJobResponse> {
  return request<ImportJobResponse>(`/api/v1/imports/${publicId}/commit`, { method: 'POST' })
}

export async function downloadImportArtifact(publicId: string): Promise<Blob> {
  return request<Blob>(`/api/v1/imports/${publicId}/artifact`, {
    method: 'GET',
    responseType: 'blob',
  })
}

/**
 * The empty `.xlsx` template for one import type: a single header row, exactly the columns the
 * uploader checks for, every column pre-formatted as text so Excel leaves leading zeros and dates
 * alone. Server-rendered rather than assembled here, so the file the Organization Admin fills in and the
 * header the validator compares against can never drift apart.
 */
export async function downloadImportTemplate(templateKey: ImportTemplateKey): Promise<Blob> {
  return request<Blob>(`/api/v1/imports/templates/${templateKey}`, {
    method: 'GET',
    responseType: 'blob',
  })
}

export async function recordBalanceCorrection(
  payload: RecordBalanceCorrectionRequest,
): Promise<BalanceCorrectionResponse> {
  return request<BalanceCorrectionResponse>('/api/v1/balance-corrections', {
    method: 'POST',
    body: payload,
  })
}

/**
 * Server-computed before/delta/after for a correction that has not been written yet. The confirm
 * modal shows this triple; the SPA must never derive a balance itself (server is authoritative).
 */
export async function previewBalanceCorrection(
  payload: PreviewBalanceCorrectionRequest,
): Promise<BalanceCorrectionPreviewResponse> {
  return request<BalanceCorrectionPreviewResponse>('/api/v1/balance-corrections/preview', {
    method: 'POST',
    body: payload,
  })
}

export async function compensateBalanceCorrection(
  id: number,
  payload: CompensateBalanceCorrectionRequest,
): Promise<BalanceCorrectionResponse> {
  return request<BalanceCorrectionResponse>(`/api/v1/balance-corrections/${id}/compensate`, {
    method: 'POST',
    body: payload,
  })
}

export async function listBalanceCorrections(
  userPublicId?: string,
  leaveTypePublicId?: string,
  page = 0,
  size = 50,
): Promise<BalanceCorrectionListPage> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (userPublicId) params.set('userPublicId', userPublicId)
  if (leaveTypePublicId) params.set('leaveTypePublicId', leaveTypePublicId)
  return request<BalanceCorrectionListPage>(
    `/api/v1/balance-corrections?${params.toString()}`,
    { method: 'GET' },
  )
}

export async function getBalanceCorrection(id: number): Promise<BalanceCorrectionListItemResponse> {
  return request<BalanceCorrectionListItemResponse>(`/api/v1/balance-corrections/${id}`, {
    method: 'GET',
  })
}

export type CapabilityAccess = components['schemas']['Access']

/**
 * Authoritative catalog gate for one plan capability.
 *
 * Resolves only when the capability is `AVAILABLE`; the server answers 403 otherwise,
 * so callers that need a boolean must catch `ApiError` rather than read a flag.
 */
export async function getCapabilityAccess(
  capability: string,
): Promise<CapabilityAccess> {
  return request<CapabilityAccess>(
    `/api/v1/billing/capabilities/${capability}/access`,
    { method: 'GET' },
  )
}

export async function queryReport(
  definitionKey: ReportDefinitionKey,
  payload: ReportQueryRequest,
): Promise<ReportQueryResponse> {
  return request<ReportQueryResponse>(`/api/v1/reports/${definitionKey}/query`, {
    method: 'POST',
    body: payload,
  })
}

export async function createReportExport(
  definitionKey: ReportDefinitionKey,
  payload: CreateReportExportRequest,
): Promise<ReportExportResponse> {
  return request<ReportExportResponse>(`/api/v1/reports/${definitionKey}/exports`, {
    method: 'POST',
    body: payload,
  })
}

/**
 * Every export this user owns. The Report Center rehydrates from this after a re-query or page
 * turn: without it a queued job became invisible while still holding the user's only concurrency
 * slot, so every later export attempt returned 429 until the job expired a week later.
 */
export async function listReportExports(): Promise<ReportExportResponse[]> {
  return request<ReportExportResponse[]>('/api/v1/reports/exports', { method: 'GET' })
}

export async function getReportExport(id: string): Promise<ReportExportResponse> {
  return request<ReportExportResponse>(`/api/v1/reports/exports/${id}`, { method: 'GET' })
}

export async function retryReportExport(id: string): Promise<ReportExportResponse> {
  return request<ReportExportResponse>(`/api/v1/reports/exports/${id}/retry`, {
    method: 'POST',
  })
}

export async function downloadReportExport(id: string): Promise<Blob> {
  return request<Blob>(`/api/v1/reports/exports/${id}/download`, {
    method: 'GET',
    responseType: 'blob',
  })
}

export async function previewLeaveRequest(
  payload: PreviewLeaveRequestRequest,
): Promise<PreviewLeaveRequestResponse> {
  return request<PreviewLeaveRequestResponse>('/api/v1/leave-requests/preview', {
    method: 'POST',
    body: payload,
  })
}

export async function createLeaveRequest(
  payload: CreateLeaveRequestRequest,
): Promise<LeaveRequestResponse> {
  return request<LeaveRequestResponse>('/api/v1/leave-requests', {
    method: 'POST',
    body: payload,
  })
}

export async function getDashboardBalances(): Promise<BalanceCardResponse[]> {
  return request<BalanceCardResponse[]>('/api/v1/dashboard/balances', {
    method: 'GET',
  })
}

export async function getDashboardRecentRequests(): Promise<RecentRequestResponse[]> {
  return request<RecentRequestResponse[]>('/api/v1/dashboard/recent-requests', {
    method: 'GET',
  })
}

export async function getMyLeaveRequests(): Promise<RecentRequestResponse[]> {
  return request<RecentRequestResponse[]>('/api/v1/leave-requests', {
    method: 'GET',
  })
}

export async function getLeaveRequestContext(
  requestId: number,
): Promise<LeaveRequestContextResponse> {
  return request<LeaveRequestContextResponse>(`/api/v1/leave-requests/${requestId}`, {
    method: 'GET',
  })
}

export async function getPendingApprovals(): Promise<PendingApprovalResponse[]> {
  return request<PendingApprovalResponse[]>('/api/v1/approvals/pending', {
    method: 'GET',
  })
}

export async function getPendingApprovalCount(): Promise<PendingApprovalCountResponse> {
  return request<PendingApprovalCountResponse>('/api/v1/approvals/pending-count', {
    method: 'GET',
  })
}

export async function getApprovalCapability(): Promise<ApprovalCapabilityResponse> {
  return request<ApprovalCapabilityResponse>('/api/v1/approvals/capability', {
    method: 'GET',
  })
}

export async function getNotifications(): Promise<NotificationResponse[]> {
  return request<NotificationResponse[]>('/api/v1/notifications', {
    method: 'GET',
  })
}

export async function getUnreadNotificationCount(): Promise<UnreadCountResponse> {
  return request<UnreadCountResponse>('/api/v1/notifications/unread-count', {
    method: 'GET',
  })
}

export async function markNotificationRead(id: number): Promise<NotificationResponse> {
  return request<NotificationResponse>(`/api/v1/notifications/${id}/read`, {
    method: 'PATCH',
  })
}

export async function markAllNotificationsRead(): Promise<MarkAllReadResponse> {
  return request<MarkAllReadResponse>('/api/v1/notifications/mark-all-read', {
    method: 'POST',
  })
}

export async function getRecentApprovalDecisions(): Promise<RecentApprovalDecisionResponse[]> {
  return request<RecentApprovalDecisionResponse[]>('/api/v1/approvals/recent-decisions', {
    method: 'GET',
  })
}

function approvalLevelQuery(approvalLevel?: number): string {
  if (approvalLevel == null) return ''
  return `?${new URLSearchParams({ approvalLevel: String(approvalLevel) }).toString()}`
}

export async function approveLeaveRequest(
  id: number,
  approvalLevel?: number,
): Promise<LeaveRequestResponse> {
  const query = approvalLevelQuery(approvalLevel)
  return request<LeaveRequestResponse>(`/api/v1/leave-requests/${id}/approve${query}`, {
    method: 'POST',
  })
}

export async function declineLeaveRequest(
  id: number,
  reason: string,
  approvalLevel?: number,
): Promise<LeaveRequestResponse> {
  const payload: DeclineLeaveRequestRequest = { reason }
  const query = approvalLevelQuery(approvalLevel)
  return request<LeaveRequestResponse>(`/api/v1/leave-requests/${id}/decline${query}`, {
    method: 'POST',
    body: payload,
  })
}

export async function recordApprovalConcern(
  id: number,
  note: string,
  approvalLevel?: number,
): Promise<LeaveRequestResponse> {
  const payload: RecordApprovalConcernRequest = { note }
  const query = approvalLevelQuery(approvalLevel)
  return request<LeaveRequestResponse>(`/api/v1/leave-requests/${id}/concern${query}`, {
    method: 'POST',
    body: payload,
  })
}

/**
 * Plan VUELTA / FR-56 — the requester takes their own leave back. Which of these four calls is
 * available for a given row is the server's answer, carried on `request.cancellation`; the SPA
 * never compares dates to decide (see LeaveCancellationCapability).
 */
export async function cancelLeaveRequest(
  id: number,
  reason?: string,
): Promise<LeaveRequestResponse> {
  const payload: CancelLeaveRequestRequest = { reason }
  return request<LeaveRequestResponse>(`/api/v1/leave-requests/${id}/cancel`, {
    method: 'POST',
    body: payload,
  })
}

export async function requestLeaveCancellation(
  id: number,
  reason: string,
): Promise<CancellationRequestResponse> {
  const payload: RequestLeaveCancellationRequest = { reason }
  return request<CancellationRequestResponse>(
    `/api/v1/leave-requests/${id}/cancellation-request`,
    { method: 'POST', body: payload },
  )
}

export async function approveLeaveCancellation(
  id: number,
  note?: string,
): Promise<LeaveRequestResponse> {
  const payload: ApproveLeaveCancellationRequest = { note }
  return request<LeaveRequestResponse>(
    `/api/v1/leave-requests/${id}/cancellation-request/approve`,
    { method: 'POST', body: payload },
  )
}

export async function declineLeaveCancellation(
  id: number,
  note: string,
): Promise<LeaveRequestResponse> {
  const payload: DeclineLeaveCancellationRequest = { note }
  return request<LeaveRequestResponse>(
    `/api/v1/leave-requests/${id}/cancellation-request/decline`,
    { method: 'POST', body: payload },
  )
}

export async function getPendingCancellations(): Promise<PendingCancellationResponse[]> {
  return request<PendingCancellationResponse[]>('/api/v1/approvals/cancellations/pending', {
    method: 'GET',
  })
}

export async function getPendingCancellationCount(): Promise<PendingApprovalCountResponse> {
  return request<PendingApprovalCountResponse>('/api/v1/approvals/cancellations/pending-count', {
    method: 'GET',
  })
}

export async function getLeaveRequestAuditEvents(
  requestId: number,
): Promise<AuditEventResponse[]> {
  return request<AuditEventResponse[]>(`/api/v1/leave-requests/${requestId}/audit-events`, {
    method: 'GET',
  })
}

export async function getCalendarMonth(
  month: string,
  workforceGroupId?: number,
): Promise<CalendarMonthResponse> {
  const params = new URLSearchParams({ month })
  if (workforceGroupId != null) {
    params.set('workforceGroupId', String(workforceGroupId))
  }
  return request<CalendarMonthResponse>(`/api/v1/calendar?${params.toString()}`, {
    method: 'GET',
  })
}

/** One entry per provider Leaveo can sync to (Plan PUENTE B2); DISCONNECTED rows are included. */
export async function getCalendarSyncStatus(): Promise<CalendarSyncStatusResponse[]> {
  return request<CalendarSyncStatusResponse[]>('/api/v1/calendar-sync/status', {
    method: 'GET',
  })
}

export async function connectCalendarSync(
  provider: CalendarSyncStatusResponse['provider'] = 'GOOGLE',
): Promise<CalendarSyncConnectResponse> {
  return request<CalendarSyncConnectResponse>(
    `/api/v1/calendar-sync/${provider.toLowerCase()}/connect`,
    { method: 'POST' },
  )
}

export async function retryCalendarSync(
  provider: CalendarSyncStatusResponse['provider'] = 'GOOGLE',
): Promise<void> {
  return request<void>(`/api/v1/calendar-sync/${provider.toLowerCase()}/retry`, {
    method: 'POST',
  })
}

export async function disconnectCalendarSync(
  provider: CalendarSyncStatusResponse['provider'] = 'GOOGLE',
): Promise<void> {
  return request<void>(`/api/v1/calendar-sync/${provider.toLowerCase()}`, {
    method: 'DELETE',
  })
}

// Plan PUENTE B4: private ICS subscription feed. The URL comes back from create exactly once;
// status never repeats it, so the card can only ever show what the server just minted.
export async function getCalendarFeed(): Promise<CalendarFeedStatusResponse> {
  return request<CalendarFeedStatusResponse>('/api/v1/calendar-feeds/me')
}

export async function createCalendarFeed(): Promise<CalendarFeedLinkResponse> {
  return request<CalendarFeedLinkResponse>('/api/v1/calendar-feeds', { method: 'POST' })
}

export async function deleteCalendarFeed(): Promise<void> {
  return request<void>('/api/v1/calendar-feeds', { method: 'DELETE' })
}

// Plan PUENTE B5: chat channels (Slack / Teams incoming webhooks). Organization Admin only; the webhook URL
// is write-only — responses carry the host, never the URL.
export async function getChatWebhooks(): Promise<ChatWebhookResponse[]> {
  return request<ChatWebhookResponse[]>('/api/v1/chat-webhooks', { method: 'GET' })
}

export async function createChatWebhook(body: ChatWebhookUpsertRequest): Promise<ChatWebhookResponse> {
  return request<ChatWebhookResponse>('/api/v1/chat-webhooks', { method: 'POST', body })
}

export async function updateChatWebhook(
  id: number,
  body: ChatWebhookUpsertRequest,
): Promise<ChatWebhookResponse> {
  return request<ChatWebhookResponse>(`/api/v1/chat-webhooks/${id}`, { method: 'PATCH', body })
}

export async function deleteChatWebhook(id: number): Promise<void> {
  return request<void>(`/api/v1/chat-webhooks/${id}`, { method: 'DELETE' })
}

export async function testChatWebhook(id: number): Promise<void> {
  return request<void>(`/api/v1/chat-webhooks/${id}/test`, { method: 'POST' })
}

// Plan PUENTE B6: the organization's Slack app (personal DMs). Install/uninstall are Organization Admin
// only; status and link-me are for everyone. The bot token never reaches the browser.
export async function getSlackStatus(): Promise<SlackStatusResponse> {
  return request<SlackStatusResponse>('/api/v1/chat/slack/status', { method: 'GET' })
}

export async function installSlack(): Promise<SlackInstallResponse> {
  return request<SlackInstallResponse>('/api/v1/chat/slack/install', { method: 'POST' })
}

export async function disconnectSlack(): Promise<void> {
  return request<void>('/api/v1/chat/slack', { method: 'DELETE' })
}

export async function linkMeToSlack(): Promise<SlackLinkResponse> {
  return request<SlackLinkResponse>('/api/v1/chat/slack/link-me', { method: 'POST' })
}

export async function getNotificationPreferences(): Promise<
  NotificationPreferenceResponse[]
> {
  return request<NotificationPreferenceResponse[]>(
    '/api/v1/notification-preferences',
    { method: 'GET' },
  )
}

export async function updateNotificationPreference(
  payload: UpdateNotificationPreferenceRequest,
): Promise<NotificationPreferenceResponse[]> {
  return request<NotificationPreferenceResponse[]>(
    '/api/v1/notification-preferences',
    { method: 'PATCH', body: payload },
  )
}

export async function updateUserPreferences(
  payload: UpdateUserPreferencesRequest,
): Promise<UserSummaryResponse> {
  return request<UserSummaryResponse>('/api/v1/users/me/preferences', {
    method: 'PATCH',
    body: payload,
  })
}

export async function getPlatformOrganizations(): Promise<OrganizationSummaryResponse[]> {
  return request<OrganizationSummaryResponse[]>('/api/v1/platform/organizations', {
    method: 'GET',
  })
}

export async function createPlatformOrganization(
  payload: CreateOrganizationRequest,
): Promise<OrganizationSummaryResponse> {
  return request<OrganizationSummaryResponse>('/api/v1/platform/organizations', {
    method: 'POST',
    body: payload,
  })
}

export async function updatePlatformOrganizationSubscription(
  organizationId: number,
  payload: UpdateSubscriptionRequest,
): Promise<OrganizationSummaryResponse> {
  return request<OrganizationSummaryResponse>(
    `/api/v1/platform/organizations/${organizationId}/subscription`,
    {
      method: 'PATCH',
      body: payload,
    },
  )
}

export async function getDashboardOutToday(): Promise<OutTodayResponse[]> {
  return request<OutTodayResponse[]>('/api/v1/dashboard/out-today', {
    method: 'GET',
  })
}

export async function getDashboardUpcoming(): Promise<UpcomingAbsenceResponse[]> {
  return request<UpcomingAbsenceResponse[]>('/api/v1/dashboard/upcoming', {
    method: 'GET',
  })
}

export async function getTeamMembers(): Promise<TeamMemberSummaryResponse[]> {
  return request<TeamMemberSummaryResponse[]>('/api/v1/team-members', {
    method: 'GET',
  })
}

export async function getTeamMember(id: number): Promise<TeamMemberDetailResponse> {
  return request<TeamMemberDetailResponse>(`/api/v1/team-members/${id}`, {
    method: 'GET',
  })
}

/**
 * The Settings "Add Team Member" action sends an invitation rather than activating a billable
 * user directly. No seat is taken until the invitee accepts — the plan limit counts active users
 * only, and is re-checked under lock at acceptance.
 *
 * Returns `TeamMemberInvitationResponse`, not `TeamMemberDetailResponse`: the invited person has
 * no user record, id, or entitlements yet, so declaring the detail shape here would hand callers
 * fields that are always undefined.
 */
export async function createTeamMember(
  payload: CreateTeamMemberRequest,
): Promise<TeamMemberInvitationResponse> {
  return request<TeamMemberInvitationResponse>('/api/v1/team-members/invitations', {
    method: 'POST',
    body: payload,
  })
}

export async function createCheckoutSession(
  payload: CreateCheckoutSessionRequest,
): Promise<CheckoutSessionResponse> {
  return request<CheckoutSessionResponse>('/api/v1/billing/checkout-session', {
    method: 'POST',
    body: payload,
  })
}

export type BillingSubscription = {
  plan: 'FREE' | 'GROWTH' | 'INTERNAL'
  billingStatus: 'PENDING_PAYMENT' | 'ACTIVE' | 'PAST_DUE_GRACE' | 'RESTRICTED'
    | 'CANCEL_AT_PERIOD_END' | 'CANCELED' | 'MANUAL_ACTIVE' | 'MANUAL_SUSPENDED'
  activeSeats: number
  pendingInvitations: number
  billableQuantity: number
  seatLimit: number
  pendingPlan: 'FREE' | 'GROWTH' | null
  graceEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export function getBillingSubscription(): Promise<BillingSubscription> {
  return request<BillingSubscription>('/api/v1/billing/subscription', { method: 'GET' })
}

export function createBillingPortalSession(): Promise<{ portalUrl: string }> {
  return request<{ portalUrl: string }>('/api/v1/billing/portal-session', { method: 'POST' })
}

export function scheduleBillingDowngrade(
  targetPlan: 'FREE',
): Promise<BillingSubscription> {
  return request<BillingSubscription>('/api/v1/billing/schedule-downgrade', {
    method: 'POST',
    body: { targetPlan },
  })
}

export async function updateTeamMember(
  id: number,
  payload: UpdateTeamMemberRequest,
): Promise<TeamMemberDetailResponse> {
  return request<TeamMemberDetailResponse>(`/api/v1/team-members/${id}`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function updateTeamMemberStatus(
  id: number,
  payload: UpdateTeamMemberStatusRequest,
): Promise<TeamMemberSummaryResponse> {
  return request<TeamMemberSummaryResponse>(`/api/v1/team-members/${id}/status`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function deactivateTeamMember(id: number): Promise<TeamMemberSummaryResponse> {
  return updateTeamMemberStatus(id, { status: 'DEACTIVATED' })
}

export async function reactivateTeamMember(id: number): Promise<TeamMemberSummaryResponse> {
  return updateTeamMemberStatus(id, { status: 'ACTIVE' })
}

export const apiClient = {
  baseUrl,
  postLogin,
  postRefresh,
  postLogout,
  getMe,
  postForgotPassword,
  postResetPassword,
  postAcceptInvitation,
  getWorkforceGroups,
  createWorkforceGroup,
  putWorkforceGroupWeekendDays,
  getPublicHolidays,
  createPublicHoliday,
  updatePublicHoliday,
  deletePublicHoliday,
  getLeaveTypes,
  getManagedLeaveTypes,
  createLeaveType,
  updateLeaveType,
  deactivateLeaveType,
  reactivateLeaveType,
  reorderLeaveTypes,
  getPolicySettingsOverview,
  createPolicyDraft,
  getPolicyDraft,
  updatePolicyDraft,
  previewPolicy,
  publishPolicy,
  getPolicyHistory,
  createImportJob,
  uploadImportSource,
  getImportJob,
  listImportJobs,
  getImportRows,
  commitImportJob,
  downloadImportArtifact,
  downloadImportTemplate,
  recordBalanceCorrection,
  previewBalanceCorrection,
  compensateBalanceCorrection,
  listBalanceCorrections,
  getBalanceCorrection,
  getCapabilityAccess,
  queryReport,
  createReportExport,
  listReportExports,
  getReportExport,
  retryReportExport,
  downloadReportExport,
  previewLeaveRequest,
  createLeaveRequest,
  getDashboardBalances,
  getDashboardRecentRequests,
  getMyLeaveRequests,
  getLeaveRequestContext,
  getPendingApprovals,
  getPendingApprovalCount,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getRecentApprovalDecisions,
  approveLeaveRequest,
  declineLeaveRequest,
  cancelLeaveRequest,
  requestLeaveCancellation,
  approveLeaveCancellation,
  declineLeaveCancellation,
  getPendingCancellations,
  getPendingCancellationCount,
  getDashboardOutToday,
  getDashboardUpcoming,
  getCalendarMonth,
  getCalendarSyncStatus,
  connectCalendarSync,
  retryCalendarSync,
  disconnectCalendarSync,
  getCalendarFeed,
  createCalendarFeed,
  deleteCalendarFeed,
  getChatWebhooks,
  createChatWebhook,
  updateChatWebhook,
  deleteChatWebhook,
  testChatWebhook,
  getPlatformOrganizations,
  createPlatformOrganization,
  updatePlatformOrganizationSubscription,
  getTeamMembers,
  getTeamMember,
  createTeamMember,
  createCheckoutSession,
  getBillingSubscription,
  createBillingPortalSession,
  scheduleBillingDowngrade,
  updateTeamMember,
  updateTeamMemberStatus,
  deactivateTeamMember,
  reactivateTeamMember,
}
