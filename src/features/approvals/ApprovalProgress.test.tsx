import { render, screen, within } from '@testing-library/react'
import { mockApprovalStepEvidence } from '../../test/apiFixtures'
import { ApprovalProgress } from './ApprovalProgress'

describe('ApprovalProgress', () => {
  it('[P0] presents a level-one decline as declined evidence, not a generic skip', () => {
    render(
      <ApprovalProgress evidence={[mockApprovalStepEvidence({
        level: 1,
        nominalApproverId: 3,
        nominalApproverFullName: 'Alex Manager',
        status: 'SKIPPED',
        result: 'DECLINED',
        current: false,
        actedOnBehalf: false,
        actualActorId: 3,
        actualActorFullName: 'Alex Manager',
        note: 'Coverage conflict',
        decidedAt: '2026-08-10T12:00:00Z',
      })]} />,
    )

    expect(screen.getByText('Declined')).toBeInTheDocument()
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument()
  })

  it('[P1] presents ordered evidence with nominal and on-behalf actor context', () => {
    render(
      <ApprovalProgress evidence={[
        mockApprovalStepEvidence({
          level: 1,
          nominalApproverId: 3,
          nominalApproverFullName: 'Alex Manager',
          status: 'APPROVED',
          result: 'APPROVED',
          current: false,
          actedOnBehalf: false,
          actualActorId: 3,
          actualActorFullName: 'Alex Manager',
          decidedAt: '2026-08-10T11:00:00Z',
        }),
        mockApprovalStepEvidence({
          level: 2,
          nominalApproverId: 7,
          nominalApproverFullName: 'Parker PM',
          status: 'CONCERN_RECORDED',
          result: 'CONCERN_RECORDED',
          current: false,
          actedOnBehalf: true,
          actualActorId: 9,
          actualActorFullName: 'Harper HR',
          note: 'Project coverage was discussed',
          decidedAt: '2026-08-10T12:00:00Z',
        }),
        mockApprovalStepEvidence({
          level: 3,
          nominalApproverId: 11,
          nominalApproverFullName: 'Dana Lead',
          status: 'PENDING',
          result: null,
          current: true,
          actedOnBehalf: false,
          actualActorId: null,
          actualActorFullName: null,
          decidedAt: null,
        }),
      ]} />,
    )

    const steps = within(screen.getByTestId('approval-progress')).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[0]).toHaveTextContent('Level 1Alex ManagerApproved')
    expect(steps[1]).toHaveTextContent('Level 2Parker PMConcern recorded')
    expect(steps[1]).toHaveTextContent(
      'Recorded by Harper HR on behalf of the assigned approver',
    )
    expect(steps[1]).toHaveTextContent('Project coverage was discussed')
    expect(steps[2]).toHaveTextContent('Level 3Dana LeadPending')
    expect(steps[2]).toHaveAttribute('data-current', 'true')
  })
})
