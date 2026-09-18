import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { mockPendingApprovalResponse } from '../../test/apiFixtures'
import { ApprovalCard } from './ApprovalCard'

const approval = mockPendingApprovalResponse({
  requestId: 101,
  employeeUserId: 7,
  employeeFullName: 'Sarah Chen',
  dateFrom: '2026-08-03',
  dateTo: '2026-08-07',
  workingDays: 5,
  note: null,
})

describe('ApprovalCard query feedback ATDD — Story 10.8 / 11.4', () => {
  test('[P1] identifies only the pending approval action as busy while disabling both row actions', () => {
    render(
      <ApprovalCard
        approval={approval}
        coverage={{ overlappingAbsences: 0 }}
        isApproving
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onConcern={vi.fn()}
      />,
    )

    expect(screen.getByTestId('approve-btn-101')).toBeDisabled()
    expect(screen.getByTestId('approve-btn-101')).toHaveAttribute('data-busy', 'true')
    expect(screen.getByTestId('decline-btn-101')).toBeDisabled()
    expect(screen.getByTestId('decline-btn-101')).not.toHaveAttribute('data-busy')
  })

  // Story 11.4 retro item 2 / APPROVAL-VAL-016: the coverage number is a server
  // read-model fact. When the API does not supply it the card must say the facts are
  // unavailable — it must never fall back to zero, which reads as "nobody is away"
  // and is the most dangerous possible wrong answer for an approver.
  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('[P0] reports unavailable coverage rather than a number when the fact is %s', (_label, value) => {
    render(
      <ApprovalCard
        approval={approval}
        coverage={{ overlappingAbsences: value }}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onConcern={vi.fn()}
      />,
    )

    const region = screen.getByTestId('approval-coverage-101')
    expect(region).toHaveTextContent('Some coverage facts are unavailable.')
    expect(region).not.toHaveTextContent(/away during this range/i)
    expect(region.textContent ?? '').not.toMatch(/\d/)
  })

  // The counted branch and its reworded copy had no test at any count above zero:
  // every render passed 0, null or undefined. Missing i18n keys resolve to '' here,
  // so a renamed `coverage.overlap_*` key renders a blank coverage line and would
  // still satisfy a presence-only check — these assert the real sentence.
  test.each([
    [1, '1 colleague is away during this range.'],
    [3, '3 colleagues are away during this range.'],
  ])('[P0] renders the overlap sentence for a count of %i', (count, expected) => {
    render(
      <ApprovalCard
        approval={approval}
        coverage={{ overlappingAbsences: count }}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onConcern={vi.fn()}
      />,
    )

    const region = screen.getByTestId('approval-coverage-101')
    expect(region).toHaveTextContent(expected)
    expect(region).not.toHaveTextContent('Some coverage facts are unavailable.')
  })

  test('[P0] renders the no-overlap sentence for a count of zero', () => {
    render(
      <ApprovalCard
        approval={approval}
        coverage={{ overlappingAbsences: 0 }}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onConcern={vi.fn()}
      />,
    )

    const region = screen.getByTestId('approval-coverage-101')
    expect(region).toHaveTextContent(
      'No colleagues are away during this range.',
    )
    expect(region).not.toHaveTextContent('Confirm available')
    expect(region).not.toHaveTextContent('Some coverage facts are unavailable.')
  })

  test('[P1][Story 10.10] qualifies repeated approval actions with the employee name', () => {
    render(
      <ApprovalCard
        approval={approval}
        coverage={{ overlappingAbsences: 0 }}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onConcern={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /approve request.*sarah chen/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline request.*sarah chen/i })).toBeInTheDocument()
  })

  test('[P0] documentary levels offer approval or concern without balance or day guards', () => {
    render(
      <ApprovalCard
        approval={{
          ...approval,
          approvalLevel: 2,
          workingDays: 0,
          balanceCapped: true,
          balanceSufficient: false,
          approvalEvidence: [
            {
              level: 1,
              nominalApproverId: 3,
              nominalApproverFullName: 'Alex Manager',
              status: 'APPROVED',
              result: 'APPROVED',
              actualActorId: 3,
              actualActorFullName: 'Alex Manager',
              note: null,
              decidedAt: '2026-08-01T10:00:00Z',
              actedOnBehalf: false,
              current: false,
            },
            {
              level: 2,
              nominalApproverId: 9,
              nominalApproverFullName: 'Parker PM',
              status: 'PENDING',
              result: null,
              actualActorId: null,
              actualActorFullName: null,
              note: null,
              decidedAt: null,
              actedOnBehalf: false,
              current: true,
            },
          ],
        }}
        coverage={{ overlappingAbsences: 0 }}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onConcern={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('decline-btn-101')).not.toBeInTheDocument()
    expect(screen.getByTestId('concern-btn-101')).toBeEnabled()
    expect(screen.getByTestId('approve-btn-101')).toBeEnabled()
    expect(screen.getByText('Parker PM')).toBeInTheDocument()
  })

  // Story 11.4 UX pass: names, leave types, groups and notes are entered by users and
  // are NOT translated with the UI. Without `dir="auto"` they inherit the page
  // direction, so Latin text inside the Arabic UI renders with its trailing
  // punctuation moved to the wrong end (".Family reunion in Alexandria"). `auto`
  // resolves direction from the content's own first strong character instead.
  test('[P0] renders user-entered text with its own direction, not the UI locale\'s', () => {
    render(
      <ApprovalCard
        approval={{
          ...approval,
          note: 'Family reunion in Alexandria.',
          workforceGroupName: 'Engineering — Egypt',
        }}
        coverage={{ overlappingAbsences: 0 }}
        onApprove={vi.fn()}
        onDecline={vi.fn()}
        onConcern={vi.fn()}
      />,
    )

    // Employee name
    expect(screen.getByTestId('approval-card-heading-101')).toHaveAttribute('dir', 'auto')
    // Leave type name (user-configurable in settings)
    expect(screen.getByText(/Annual Leave/).closest('[dir]')).toHaveAttribute('dir', 'auto')
    // Workforce group name
    expect(screen.getByText('Engineering — Egypt')).toHaveAttribute('dir', 'auto')
    // Free-text employee note
    expect(screen.getByText('Family reunion in Alexandria.')).toHaveAttribute('dir', 'auto')
  })
})
