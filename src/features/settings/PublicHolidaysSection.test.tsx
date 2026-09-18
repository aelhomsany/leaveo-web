import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { PublicHolidaysSection } from './PublicHolidaysSection'

function renderSection(options?: { onWarning?: (message: string) => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onWarning = options?.onWarning ?? vi.fn()

  return {
    onWarning,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
          <PublicHolidaysSection
            activeGroupId={1}
            activeGroupName="US"
            onSuccess={vi.fn()}
            onWarning={onWarning}
          />
        </AuthTestProvider>
      </QueryClientProvider>,
    ),
  }
}

describe('PublicHolidaysSection', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([])
    vi.spyOn(apiClient, 'createPublicHoliday').mockResolvedValue({
      id: 10,
      workforceGroupId: 1,
      dateFrom: '2026-09-01',
      dateTo: '2026-09-01',
      name: 'Labor Day',
    })
    vi.spyOn(apiClient, 'updatePublicHoliday').mockResolvedValue({
      id: 1,
      workforceGroupId: 1,
      dateFrom: '2026-07-04',
      dateTo: '2026-07-04',
      name: 'Independence Day (observed)',
    })
    vi.spyOn(apiClient, 'deletePublicHoliday').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders empty state', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('No holidays yet')).toBeInTheDocument()
    })
    expect(screen.getByText('Public holidays —')).toBeInTheDocument()
    expect(screen.getByText('US', { selector: '.public-holidays-label span' })).toBeInTheDocument()
  })

  it('calls POST with a date range when adding a holiday', async () => {
    renderSection()

    await waitFor(() => {
      expect(
        screen.getByLabelText(/New holiday start date for US/i),
      ).toBeInTheDocument()
    })

    const fromInput = screen.getByLabelText(/New holiday start date for US/i)
    const toInput = screen.getByLabelText(/New holiday end date for US/i)
    const nameInput = screen.getByLabelText(/New holiday name for US/i)
    fireEvent.change(fromInput, { target: { value: '2026-06-06' } })
    fireEvent.change(toInput, { target: { value: '2026-06-09' } })
    fireEvent.change(nameInput, { target: { value: 'Eid al-Adha' } })

    await waitFor(() => {
      expect(fromInput).toHaveValue('2026-06-06')
      expect(toInput).toHaveValue('2026-06-09')
      expect(nameInput).toHaveValue('Eid al-Adha')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(apiClient.createPublicHoliday).toHaveBeenCalled()
    })

    expect(vi.mocked(apiClient.createPublicHoliday).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        workforceGroupId: 1,
        dateFrom: '2026-06-06',
        dateTo: '2026-06-09',
        name: 'Eid al-Adha',
      }),
    )
  })

  it('defaults dateTo to dateFrom when To is left empty', async () => {
    renderSection()

    await waitFor(() => {
      expect(
        screen.getByLabelText(/New holiday start date for US/i),
      ).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/New holiday start date for US/i), {
      target: { value: '2026-09-01' },
    })
    fireEvent.change(screen.getByLabelText(/New holiday name for US/i), {
      target: { value: 'Labor Day' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(apiClient.createPublicHoliday).toHaveBeenCalled()
    })

    expect(vi.mocked(apiClient.createPublicHoliday).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        workforceGroupId: 1,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-01',
        name: 'Labor Day',
      }),
    )
  })

  it('calls PATCH with the range when saving an edit', async () => {
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([
      {
        id: 1,
        workforceGroupId: 1,
        dateFrom: '2026-07-04',
        dateTo: '2026-07-04',
        name: 'Independence Day',
      },
    ])

    const user = userEvent.setup()
    renderSection()

    await waitFor(() => {
      expect(screen.getByText(/Independence Day/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /edit.*independence day/i }))
    await user.clear(screen.getByLabelText(/Edit name for Independence Day/i))
    await user.type(
      screen.getByLabelText(/Edit name for Independence Day/i),
      'Independence Day (observed)',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(apiClient.updatePublicHoliday).toHaveBeenCalledWith(1, {
        dateFrom: '2026-07-04',
        dateTo: '2026-07-04',
        name: 'Independence Day (observed)',
      })
    })
  })

  it('renders a multi-day holiday as a range', async () => {
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([
      {
        id: 3,
        workforceGroupId: 1,
        dateFrom: '2026-06-06',
        dateTo: '2026-06-09',
        name: 'Eid al-Adha',
      },
    ])

    renderSection()

    await waitFor(() => {
      expect(screen.getByText(/Eid al-Adha/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Jun 6, 2026 – Jun 9, 2026/)).toBeInTheDocument()
  })

  it('[P2] warns when Add is clicked without start date and name', async () => {
    const onWarning = vi.fn()
    renderSection({ onWarning })

    await waitFor(() => {
      expect(
        screen.getByLabelText(/New holiday start date for US/i),
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onWarning).toHaveBeenCalledWith('Enter a start date and name')
    expect(apiClient.createPublicHoliday).not.toHaveBeenCalled()
  })

  it('[P2] warns when holiday name is whitespace only', async () => {
    const onWarning = vi.fn()
    renderSection({ onWarning })

    await waitFor(() => {
      expect(
        screen.getByLabelText(/New holiday start date for US/i),
      ).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/New holiday start date for US/i), {
      target: { value: '2026-09-01' },
    })
    fireEvent.change(screen.getByLabelText(/New holiday name for US/i), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onWarning).toHaveBeenCalledWith('Enter a start date and name')
    expect(apiClient.createPublicHoliday).not.toHaveBeenCalled()
  })

  it('[P2] warns when end date is before start date', async () => {
    const onWarning = vi.fn()
    renderSection({ onWarning })

    await waitFor(() => {
      expect(
        screen.getByLabelText(/New holiday start date for US/i),
      ).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/New holiday start date for US/i), {
      target: { value: '2026-06-10' },
    })
    fireEvent.change(screen.getByLabelText(/New holiday end date for US/i), {
      target: { value: '2026-06-05' },
    })
    fireEvent.change(screen.getByLabelText(/New holiday name for US/i), {
      target: { value: 'Invalid range' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onWarning).toHaveBeenCalledWith(
      'End date must be on or after start date',
    )
    expect(apiClient.createPublicHoliday).not.toHaveBeenCalled()
  })

  it('calls DELETE when removing a holiday', async () => {
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([
      {
        id: 2,
        workforceGroupId: 1,
        dateFrom: '2026-06-19',
        dateTo: '2026-06-19',
        name: 'Juneteenth',
      },
    ])

    const user = userEvent.setup()
    renderSection()

    await waitFor(() => {
      expect(screen.getByText(/Juneteenth/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /remove.*juneteenth/i }))

    await waitFor(() => {
      expect(apiClient.deletePublicHoliday).toHaveBeenCalledWith(
        2,
        expect.anything(),
      )
    })
  })
})

/**
 * Story 10.10 — UXA-07 contextual accessible names on holiday card actions.
 */
describe('PublicHolidaysSection accessibility ATDD — Story 10.10', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([
      {
        id: 2,
        workforceGroupId: 1,
        dateFrom: '2026-06-19',
        dateTo: '2026-06-19',
        name: 'Juneteenth',
      },
    ])
    vi.spyOn(apiClient, 'deletePublicHoliday').mockResolvedValue(undefined)
    vi.spyOn(apiClient, 'updatePublicHoliday').mockResolvedValue({
      id: 2,
      workforceGroupId: 1,
      dateFrom: '2026-06-19',
      dateTo: '2026-06-19',
      name: 'Juneteenth',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('[P1] holiday Edit and Remove actions include the holiday name in their accessible name', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit.*juneteenth/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /remove.*juneteenth/i })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument()
  })
})
