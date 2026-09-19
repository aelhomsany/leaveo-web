import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '../../i18n/config'
import type { RecentApprovalDecisionResponse } from '../../api/generated/types'
import { mockRecentApprovalDecision } from '../../test/apiFixtures'
import { RecentDecisionRow } from './RecentDecisionRow'

function renderRow(decision: RecentApprovalDecisionResponse) {
  return render(
    <table>
      <tbody>
        <RecentDecisionRow decision={decision} />
      </tbody>
    </table>,
  )
}

function baseDecision(
  overrides: Partial<RecentApprovalDecisionResponse> = {},
): RecentApprovalDecisionResponse {
  return mockRecentApprovalDecision({
    requestId: 1,
    employeeFullName: 'Riley Report',
    leaveTypeName: 'Annual Leave',
    dateFrom: '2026-08-10',
    dateTo: '2026-08-11',
    workingDays: 2,
    actorFirstName: 'Alex',
    decidedAt: '2026-08-12T10:00:00Z',
    ...overrides,
  })
}

describe('RecentDecisionRow', () => {
  beforeAll(async () => {
    if (i18n.language !== 'en') {
      await i18n.changeLanguage('en')
    }
  })

  it('renders an approved badge when decisionResult is APPROVED', () => {
    renderRow(baseDecision({ decisionResult: 'APPROVED' }))
    const row = screen.getByTestId('recent-decision-row-1')
    expect(row.querySelector('.badge-approved')).toHaveTextContent('Approved')
  })

  it('renders a declined badge when decisionResult is DECLINED', () => {
    renderRow(baseDecision({ decisionResult: 'DECLINED' }))
    const row = screen.getByTestId('recent-decision-row-1')
    expect(row.querySelector('.badge-declined')).toHaveTextContent('Declined')
    expect(row.querySelector('.badge-approved')).not.toBeInTheDocument()
  })

  it('renders a concern-recorded badge when decisionResult is CONCERN_RECORDED', () => {
    renderRow(baseDecision({ decisionResult: 'CONCERN_RECORDED' }))
    const row = screen.getByTestId('recent-decision-row-1')
    expect(row.querySelector('.badge-pending')).toHaveTextContent('Concern recorded')
  })

  it('falls back to APPROVED styling when decisionResult is absent (legacy rows)', () => {
    renderRow(baseDecision({ decisionResult: undefined }))
    const row = screen.getByTestId('recent-decision-row-1')
    expect(row.querySelector('.badge-approved')).toHaveTextContent('Approved')
  })
})
