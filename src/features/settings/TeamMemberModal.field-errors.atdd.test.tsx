import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import { ApiError } from '../../api/client'
import type {
  LeaveTypeResponse,
  ProblemDetail,
} from '../../api/generated/types'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockTeamMemberSummary, mockWorkforceGroup } from '../../test/apiFixtures'
import i18n from '../../i18n/config'
import { TeamMemberModal } from './TeamMemberModal'
import { MemoryRouter } from 'react-router-dom'

const mockGroups = [mockWorkforceGroup({ id: 1, name: 'US' })]

const mockLeaveTypes: LeaveTypeResponse[] = [
  {
    id: 1,
    publicId: 'public-1',
    name: 'Annual Leave',
    icon: '🌴',
    color: '#093C5D',
    backgroundColor: '#D6E8ED',
    borderColor: '#0E4F75',
    presenceType: 'OFF',
    defaultBalanceDays: 20,
    displayOrder: 1,
    active: true,
    halfDayAllowed: true,
  },
]

const mockMembers = [
  mockTeamMemberSummary({
    id: 5,
    fullName: 'Jordan HR',
    email: 'hr@company.com',
    department: 'People Ops',
    role: 'ORGANIZATION_ADMIN',
    workforceGroupId: 1,
    workforceGroupName: 'US',
  }),
]

function renderModal(onClose = vi.fn(), onWarning = vi.fn()) {
  vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue(mockGroups)
  vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue(mockLeaveTypes)
  vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue(mockMembers)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
          <TeamMemberModal
            editMemberId={null}
            onClose={onClose}
            onSuccess={vi.fn()}
            onWarning={onWarning}
          />
        </AuthTestProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { onClose, onWarning }
}

describe('TeamMemberModal ATDD - Story 10.4 field-level server validation', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
  })


  it('[P0] renders inline field errors and marks matching inputs aria-invalid', async () => {
    const user = userEvent.setup()
    const problem: ProblemDetail = {
      status: 400,
      title: 'Validation failed',
      detail: 'Request failed validation',
      type: 'https://leaveo.net/errors/validation-failed',
      violations: [
        { field: 'fullName', message: 'Full name is required' },
        { field: 'email', message: 'Email must be valid' },
        { field: 'workforceGroupId', message: 'Workforce Group is required' },
      ],
    }

    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(
      new ApiError(400, problem),
    )

    const { onWarning } = renderModal()

    await waitFor(() => {
      expect(screen.getByLabelText(/Full name/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/Full name/i), 'Jordan Lee')
    await user.type(screen.getByLabelText(/Email/i), 'jordan@example.com')
    await user.type(screen.getByLabelText(/Department/i), 'People Ops')
    await user.selectOptions(screen.getByLabelText(/Role/i), 'EMPLOYEE')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(screen.getByTestId('field-error-tm-fullname')).toHaveTextContent(
        'Full name is required',
      )
    })

    expect(onWarning).not.toHaveBeenCalled()
    expect(screen.getByTestId('field-error-tm-email')).toHaveTextContent('Email must be valid')
    expect(screen.getByTestId('field-error-tm-group')).toHaveTextContent(
      'Workforce Group is required',
    )
    expect(screen.getByLabelText(/Full name/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/Email/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/Workforce Group/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('[P1] preserves the warning path for a server field that has no form control', async () => {
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(
      new ApiError(400, {
        status: 400,
        title: 'Validation failed',
        detail: 'Allocated days must be greater than or equal to 0',
        type: 'https://leaveo.net/errors/validation-failed',
        violations: [
          { field: 'entitlements[0].allocatedDays', message: 'must be greater than or equal to 0' },
        ],
      } satisfies ProblemDetail),
    )

    const { onWarning } = renderModal()

    await waitFor(() => {
      expect(screen.getByLabelText(/Full name/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/Full name/i), 'Jordan Lee')
    await user.type(screen.getByLabelText(/Email/i), 'jordan@example.com')
    await user.type(screen.getByLabelText(/Department/i), 'People Ops')
    await user.selectOptions(screen.getByLabelText(/Workforce Group/i), '1')
    await user.click(screen.getByRole('button', { name: /Save/i }))

    await waitFor(() => {
      expect(onWarning).toHaveBeenCalledWith('Allocated days must be greater than or equal to 0')
    })
  })

  it('[Story 9.4] translates known field violations under the Arabic locale, falling back to the raw message for unmapped fields', async () => {
    await i18n.changeLanguage('ar')
    const user = userEvent.setup()
    const problem: ProblemDetail = {
      status: 400,
      title: 'Validation failed',
      detail: 'Request failed validation',
      type: 'https://leaveo.net/errors/validation-failed',
      violations: [
        { field: 'fullName', message: 'must not be blank' },
        { field: 'email', message: 'must be a well-formed email address' },
        { field: 'workforceGroupId', message: 'Workforce Group is required' },
      ],
    }

    vi.spyOn(apiClient, 'createTeamMember').mockRejectedValue(new ApiError(400, problem))

    renderModal()

    await waitFor(() => {
      expect(screen.getByLabelText(/الاسم الكامل/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/الاسم الكامل/i), 'Jordan Lee')
    await user.type(screen.getByLabelText(/البريد الإلكتروني/i), 'jordan@example.com')
    await user.type(screen.getByLabelText(/القسم/i), 'People Ops')
    await user.selectOptions(screen.getByLabelText(/الدور/i), 'EMPLOYEE')
    await user.selectOptions(screen.getByLabelText(/مجموعة العمل/i), '1')
    await user.click(screen.getByRole('button', { name: /حفظ/i }))

    // Mapped fields render the Arabic translation, not the raw English server message.
    await waitFor(() => {
      expect(screen.getByTestId('field-error-tm-fullname')).toHaveTextContent('الاسم الكامل مطلوب')
    })
    expect(screen.getByTestId('field-error-tm-email')).toHaveTextContent(
      'أدخل بريدًا إلكترونيًا صالحًا',
    )
    // workforceGroupId has no entry in the field-violation translation map (by
    // design, matching the story's minimum table) — the raw server message passes through.
    expect(screen.getByTestId('field-error-tm-group')).toHaveTextContent(
      'Workforce Group is required',
    )
  })
})
