import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { AuditEventResponse } from '../../api/generated/types'
import { AuditHistoryPanel } from './AuditHistoryPanel'

const mockGetLeaveRequestAuditEvents = vi.fn()

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    getLeaveRequestAuditEvents: (...args: Parameters<typeof actual.getLeaveRequestAuditEvents>) =>
      mockGetLeaveRequestAuditEvents(...args),
  }
})

const mockTimeline: AuditEventResponse[] = [
  {
    id: 1,
    action: 'SUBMITTED',
    actorUserId: 7,
    actorFirstName: 'Sarah',
    occurredAt: '2026-06-10T09:00:00Z',
    leaveRequestId: 101,
    onBehalf: false,
    nominalApproverFirstName: null,
  },
  {
    id: 2,
    action: 'APPROVED',
    actorUserId: 12,
    actorFirstName: 'Jordan',
    occurredAt: '2026-06-11T14:30:00Z',
    leaveRequestId: 101,
    onBehalf: true,
    nominalApproverFirstName: 'Alex',
  },
]

function renderPanel(requestId = 101) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AuditHistoryPanel requestId={requestId} />
    </QueryClientProvider>,
  )
}

describe('AuditHistoryPanel', () => {
  beforeEach(() => {
    mockGetLeaveRequestAuditEvents.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('[P1] renders read-only chronological timeline with action, actor, and timestamp', async () => {
    mockGetLeaveRequestAuditEvents.mockResolvedValue(mockTimeline)

    renderPanel()

    expect(await screen.findByTestId('audit-event-1')).toHaveTextContent('Submitted')
    expect(screen.getByTestId('audit-event-1')).toHaveTextContent('Sarah')
    expect(screen.getByTestId('audit-event-2')).toHaveTextContent('Approved')
    expect(screen.getByTestId('audit-event-2')).toHaveTextContent('Jordan')
    expect(screen.getByTestId('audit-history-panel')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('[P1] shows sage on-behalf pill when onBehalf is true', async () => {
    mockGetLeaveRequestAuditEvents.mockResolvedValue(mockTimeline)

    renderPanel()

    expect(await screen.findByTestId('audit-on-behalf-pill-2')).toBeInTheDocument()
    expect(screen.getByTestId('audit-on-behalf-pill-2')).toHaveTextContent(/on behalf/i)
  })

  it('[P1] does not render on-behalf pill for SUBMITTED rows', async () => {
    mockGetLeaveRequestAuditEvents.mockResolvedValue(mockTimeline)

    renderPanel()

    await screen.findByTestId('audit-event-1')
    expect(screen.queryByTestId('audit-on-behalf-pill-1')).not.toBeInTheDocument()
  })
})
