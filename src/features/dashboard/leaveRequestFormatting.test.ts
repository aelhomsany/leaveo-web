import { describe, expect, it, beforeAll } from 'vitest'
import i18n from '../../i18n/config'
import type { RecentRequestResponse } from '../../api/generated/types'
import { mockApprovalStepEvidence, mockRecentRequestResponse } from '../../test/apiFixtures'
import { localizedRequestStatusHint } from './leaveRequestFormatting'

function baseRequest(overrides: Partial<RecentRequestResponse> = {}): RecentRequestResponse {
  return mockRecentRequestResponse({
    id: 1,
    leaveTypeId: 1,
    leaveTypeName: 'Annual Leave',
    dateFrom: '2026-08-10',
    dateTo: '2026-08-11',
    status: 'APPROVED',
    ...overrides,
  })
}

describe('localizedRequestStatusHint', () => {
  beforeAll(async () => {
    if (i18n.language !== 'en') {
      await i18n.changeLanguage('en')
    }
  })

  it('returns the pending hint for a pending request', () => {
    const request = baseRequest({ status: 'PENDING' })
    expect(localizedRequestStatusHint(request, i18n.t)).toBe('Waiting for approval')
  })

  it('returns the single-level approved-by hint when the chain has only one step', () => {
    const request = baseRequest({
      status: 'APPROVED',
      approverFirstName: 'Alex',
      approvalEvidence: [
        mockApprovalStepEvidence({ level: 1, status: 'APPROVED', result: 'APPROVED' }),
      ],
    })
    expect(localizedRequestStatusHint(request, i18n.t)).toBe('Approved by Alex')
  })

  it('returns the multi-level progress hint counting only recorded steps', () => {
    const request = baseRequest({
      status: 'APPROVED',
      approverFirstName: 'Alex',
      approvalEvidence: [
        mockApprovalStepEvidence({ level: 1, status: 'APPROVED', result: 'APPROVED' }),
        mockApprovalStepEvidence({ level: 2, status: 'CONCERN_RECORDED', result: 'CONCERN_RECORDED' }),
        mockApprovalStepEvidence({ level: 3, status: 'PENDING', result: null }),
      ],
    })
    expect(localizedRequestStatusHint(request, i18n.t))
      .toBe('Operationally approved · 2 of 3 approvals recorded')
  })

  it('returns null for a declined request', () => {
    const request = baseRequest({ status: 'DECLINED' })
    expect(localizedRequestStatusHint(request, i18n.t)).toBeNull()
  })
})
