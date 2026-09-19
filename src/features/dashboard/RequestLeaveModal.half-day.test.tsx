/**
 * Plan MEDIA (half-day leave) — the request modal: which day parts the form offers for the range it
 * holds, how a date or leave-type change clamps them, what the preview is keyed on, and how the four
 * half-day refusals read.
 *
 * Every date is in June 2026, whose 1st is a Monday; nothing here reads today's date. i18next's
 * `defaultValue` is inert in this app (a missing key renders '' and still passes toBeVisible()), so
 * every assertion pins the English text itself.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as apiClient from '../../api/client'
import type {
  LeaveRequestResponse,
  LeaveTypeResponse,
  PreviewLeaveRequestRequest,
  PreviewLeaveRequestResponse,
  ProblemDetail,
} from '../../api/generated/types'
import { isolate } from '../../i18n/bidi'
import type { DayPart } from '../../lib/leaveDays'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { RequestLeaveModal } from './RequestLeaveModal'

const MON = '2026-06-01'
const TUE = '2026-06-02'
const WED = '2026-06-03'
const FRI = '2026-06-05'
const SAT = '2026-06-06'
const SUN = '2026-06-07'
const NEXT_MON = '2026-06-08'

const VALIDATION_FAILED = 'https://leaveo.net/errors/validation-failed'

const annualLeave: LeaveTypeResponse = {
  id: 1,
  publicId: 'leave-type-annual',
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
}

// The organization has switched half days off for this one.
const bereavementLeave: LeaveTypeResponse = {
  ...annualLeave,
  id: 2,
  publicId: 'leave-type-bereavement',
  name: 'Bereavement Leave',
  icon: '🕊️',
  displayOrder: 2,
  halfDayAllowed: false,
}

type User = ReturnType<typeof userEvent.setup>

function calendarDates(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

// Weekends are the only non-working days in these ranges.
function workingDates({ dateFrom, dateTo }: PreviewLeaveRequestRequest): string[] {
  return calendarDates(dateFrom, dateTo).filter((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    return weekday !== 0 && weekday !== 6
  })
}

function validationProblem(
  code: string,
  detail: string,
  extensions: Record<string, unknown> = {},
): ProblemDetail {
  return { type: VALIDATION_FAILED, title: 'Validation failed', status: 400, detail, code, ...extensions }
}

/**
 * The server's refusal for a pair of parts, ported from WorkingDayCalculator.applyParts: a half must
 * sit on a working boundary day, one charged day takes a single part, and a longer range can
 * neither start on a morning nor end on an afternoon. Null means the server prices the request.
 */
function serverRefusal(payload: PreviewLeaveRequestRequest): ProblemDetail | null {
  const start = payload.startPart ?? 'FULL'
  const end = payload.endPart ?? 'FULL'
  const dates = workingDates(payload)
  if (dates.length === 0 || (start === 'FULL' && end === 'FULL')) {
    return null
  }
  if (start !== 'FULL' && dates[0] !== payload.dateFrom) {
    return validationProblem(
      'half-day-on-non-working-day',
      `${payload.dateFrom} is not a working day, so it cannot be taken as a half day`,
      { date: payload.dateFrom },
    )
  }
  if (end !== 'FULL' && dates[dates.length - 1] !== payload.dateTo) {
    return validationProblem(
      'half-day-on-non-working-day',
      `${payload.dateTo} is not a working day, so it cannot be taken as a half day`,
      { date: payload.dateTo },
    )
  }
  if (dates.length === 1) {
    return start !== 'FULL' && end !== 'FULL' && start !== end
      ? validationProblem(
          'contradictory-half-day-parts',
          'A single day cannot start in the afternoon and end in the morning',
        )
      : null
  }
  if (start === 'FIRST_HALF') {
    return validationProblem(
      'contradictory-half-day-parts',
      'Leave that only covers the morning of its first day must end that same day',
    )
  }
  if (end === 'SECOND_HALF') {
    return validationProblem(
      'contradictory-half-day-parts',
      'Leave that only covers the afternoon of its last day must start that same day',
    )
  }
  return null
}

/** Prices a request the server accepts: only the boundary days can be half, and a half costs 0.5. */
function previewFor(payload: PreviewLeaveRequestRequest): PreviewLeaveRequestResponse {
  const start: DayPart = payload.startPart ?? 'FULL'
  const end: DayPart = payload.endPart ?? 'FULL'
  const dates = workingDates(payload)
  const parts: DayPart[] =
    dates.length === 1
      ? [start !== 'FULL' ? start : end]
      : dates.map((_, index) => (index === 0 ? start : index === dates.length - 1 ? end : 'FULL'))
  return {
    workingDays: dates.length,
    excludedWeekends: calendarDates(payload.dateFrom, payload.dateTo).length - dates.length,
    excludedHolidays: 0,
    workforceGroupId: 1,
    workforceGroupName: 'US',
    policyVersionPublicId: 'policy-version-1',
    policyAssignmentPublicId: 'policy-assignment-1',
    allowanceMode: 'ANNUAL_ALLOWANCE',
    allowanceDays: 20,
    chargedDates: dates,
    chargedDayParts: parts,
    chargedDays: parts.reduce((sum, part) => sum + (part === 'FULL' ? 1 : 0.5), 0),
  }
}

/** The preview endpoint, pricing and refusing exactly as the server does. */
function mockPreviewServer() {
  return vi.spyOn(apiClient, 'previewLeaveRequest').mockImplementation(async (payload) => {
    const refusal = serverRefusal(payload)
    if (refusal) {
      throw new apiClient.ApiError(400, refusal)
    }
    return previewFor(payload)
  })
}

function hasHalf(payload: PreviewLeaveRequestRequest): boolean {
  return (payload.startPart ?? 'FULL') !== 'FULL' || (payload.endPart ?? 'FULL') !== 'FULL'
}

function mockCreateSuccess() {
  return vi
    .spyOn(apiClient, 'createLeaveRequest')
    .mockResolvedValue({ id: 99, status: 'PENDING' } as LeaveRequestResponse)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole('EMPLOYEE')}>
        <RequestLeaveModal open onClose={vi.fn()} />
      </AuthTestProvider>
    </QueryClientProvider>,
  )
  return { queryClient }
}

async function chooseLeaveType(user: User, leaveType: LeaveTypeResponse) {
  await screen.findByRole('option', { name: new RegExp(leaveType.name) })
  await user.selectOptions(screen.getByLabelText('Leave Type'), String(leaveType.id))
}

function setDates(from: string, to: string) {
  fireEvent.change(screen.getByTestId('leave-from-date'), { target: { value: from } })
  fireEvent.change(screen.getByTestId('leave-to-date'), { target: { value: to } })
}

function setEndDate(to: string) {
  fireEvent.change(screen.getByTestId('leave-to-date'), { target: { value: to } })
}

/** [value, label] for every option of a select, in order. */
function optionsOf(select: HTMLElement): [string, string | null][] {
  return within(select)
    .getAllByRole<HTMLOptionElement>('option')
    .map((option) => [option.value, option.textContent])
}

// The first preview after dates are entered: nothing was valid before it, so 'valid' is its answer.
async function waitForFirstPreview() {
  await waitFor(
    () => expect(screen.getByTestId('working-day-explainer')).toHaveAttribute('data-state', 'valid'),
    { timeout: 2000 },
  )
}

// The exact result line. Exact, because "0.5 working days…" contains "5 working days…". Singular
// only at exactly one day, which is where English's plural rules put it.
async function expectCharged(days: string) {
  const unit = days === '1' ? 'working day' : 'working days'
  await waitFor(
    () =>
      expect(screen.getByTestId('working-day-result').textContent).toBe(`${days} ${unit} will be charged`),
    { timeout: 2000 },
  )
}

async function submitAndExpect(
  create: ReturnType<typeof mockCreateSuccess>,
  user: User,
  payload: Parameters<typeof apiClient.createLeaveRequest>[0],
) {
  const calls = create.mock.calls.length
  await waitFor(() => expect(screen.getByTestId('submit-request-btn')).toBeEnabled())
  await user.click(screen.getByTestId('submit-request-btn'))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(calls + 1))
  expect(create).toHaveBeenLastCalledWith(payload)
}

describe('RequestLeaveModal — Plan MEDIA half days', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getLeaveTypes').mockResolvedValue([annualLeave, bereavementLeave])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('part controls', () => {
    // MEDIA-UI-VAL-001. A one-date request renders a single Duration select (day-part-single) offering
    // whole day, morning and afternoon, and its one part is sent as both ends. The form goes by dates,
    // not charged days: it cannot know how many days a range charges until the preview answers.
    it('[P0] offers one Duration select — whole day, morning, afternoon — for a one-day request', async () => {
      const preview = mockPreviewServer()
      const create = mockCreateSuccess()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      // Nothing to divide until the range exists.
      expect(screen.queryByTestId('day-part-single')).not.toBeInTheDocument()
      expect(screen.queryByTestId('day-part-range')).not.toBeInTheDocument()

      setDates(MON, MON)
      await waitForFirstPreview()

      expect(screen.getByTestId('day-part-single')).toBeInTheDocument()
      expect(screen.queryByTestId('day-part-range')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('First day')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Last day')).not.toBeInTheDocument()
      const duration = screen.getByLabelText('Duration')
      expect(optionsOf(duration)).toEqual([
        ['FULL', 'Whole day'],
        ['FIRST_HALF', 'Morning'],
        ['SECOND_HALF', 'Afternoon'],
      ])
      expect(duration).toHaveDisplayValue('Whole day')

      await user.selectOptions(duration, 'SECOND_HALF')
      await expectCharged('0.5')
      expect(preview).toHaveBeenLastCalledWith({
        dateFrom: MON,
        dateTo: MON,
        leaveTypeId: 1,
        startPart: 'SECOND_HALF',
        endPart: 'SECOND_HALF',
      })
      await submitAndExpect(create, user, {
        leaveTypeId: 1,
        dateFrom: MON,
        dateTo: MON,
        startPart: 'SECOND_HALF',
        endPart: 'SECOND_HALF',
        note: undefined,
      })
    })

    // MEDIA-UI-VAL-001. Two or more dates render day-part-range: the first day offers only
    // whole day / afternoon, the last day only whole day / morning, so the combinations the server
    // refuses cannot be picked at all.
    it('[P0] offers a first-day and a last-day select for two or more days, each with only its legal half', async () => {
      mockPreviewServer()
      const create = mockCreateSuccess()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, TUE)
      await waitForFirstPreview()

      const expectRangeControls = () => {
        expect(screen.getByTestId('day-part-range')).toBeInTheDocument()
        expect(screen.queryByTestId('day-part-single')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument()
        expect(optionsOf(screen.getByLabelText('First day'))).toEqual([
          ['FULL', 'Whole day'],
          ['SECOND_HALF', 'Afternoon only'],
        ])
        expect(optionsOf(screen.getByLabelText('Last day'))).toEqual([
          ['FULL', 'Whole day'],
          ['FIRST_HALF', 'Morning only'],
        ])
      }
      expectRangeControls()

      setEndDate(WED)
      await expectCharged('3')
      expectRangeControls()

      await user.selectOptions(screen.getByLabelText('First day'), 'SECOND_HALF')
      await user.selectOptions(screen.getByLabelText('Last day'), 'FIRST_HALF')
      await expectCharged('2')
      await submitAndExpect(create, user, {
        leaveTypeId: 1,
        dateFrom: MON,
        dateTo: WED,
        startPart: 'SECOND_HALF',
        endPart: 'FIRST_HALF',
        note: undefined,
      })
    })

    // MEDIA-UI-VAL-001. A type the organization keeps to whole days gets neither control.
    it('[P1] offers no part controls for a leave type that must be taken in whole days', async () => {
      mockPreviewServer()
      const create = mockCreateSuccess()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, bereavementLeave)
      setDates(MON, MON)
      await waitForFirstPreview()
      expect(screen.queryByTestId('day-part-single')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument()

      setEndDate(WED)
      await expectCharged('3')
      expect(screen.queryByTestId('day-part-range')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('First day')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Last day')).not.toBeInTheDocument()

      await submitAndExpect(create, user, {
        leaveTypeId: 2,
        dateFrom: MON,
        dateTo: WED,
        startPart: 'FULL',
        endPart: 'FULL',
        note: undefined,
      })
    })
  })

  describe('clamping on the way out', () => {
    // MEDIA-UI-VAL-002. Widening a one-day morning to three days makes "morning" illegal as a first
    // day, so whole days go out -- but the stored choice survives, and narrowing back restores it.
    it('[P1] clamps a morning that a wider range makes illegal, and restores it when the range narrows again', async () => {
      const preview = mockPreviewServer()
      const create = mockCreateSuccess()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, MON)
      await waitForFirstPreview()
      await user.selectOptions(screen.getByLabelText('Duration'), 'FIRST_HALF')
      await expectCharged('0.5')

      setEndDate(WED)
      expect(screen.getByLabelText('First day')).toHaveDisplayValue('Whole day')
      expect(screen.getByLabelText('Last day')).toHaveDisplayValue('Whole day')
      await expectCharged('3')
      expect(preview).toHaveBeenLastCalledWith({
        dateFrom: MON,
        dateTo: WED,
        leaveTypeId: 1,
        startPart: 'FULL',
        endPart: 'FULL',
      })
      await submitAndExpect(create, user, {
        leaveTypeId: 1,
        dateFrom: MON,
        dateTo: WED,
        startPart: 'FULL',
        endPart: 'FULL',
        note: undefined,
      })

      setEndDate(MON)
      expect(screen.getByLabelText('Duration')).toHaveDisplayValue('Morning')
      await expectCharged('0.5')
      await submitAndExpect(create, user, {
        leaveTypeId: 1,
        dateFrom: MON,
        dateTo: MON,
        startPart: 'FIRST_HALF',
        endPart: 'FIRST_HALF',
        note: undefined,
      })
    })

    // MEDIA-UI-VAL-002. Switching to a whole-days-only type sends whole days without rewriting the
    // morning picked under the previous type; switching back brings the morning back.
    it('[P1] sends whole days for a whole-days-only type without discarding the half picked under another type', async () => {
      const preview = mockPreviewServer()
      const create = mockCreateSuccess()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, MON)
      await waitForFirstPreview()
      await user.selectOptions(screen.getByLabelText('Duration'), 'FIRST_HALF')
      await expectCharged('0.5')

      await user.selectOptions(screen.getByLabelText('Leave Type'), String(bereavementLeave.id))
      expect(screen.queryByTestId('day-part-single')).not.toBeInTheDocument()
      await waitFor(() =>
        expect(preview).toHaveBeenLastCalledWith({
          dateFrom: MON,
          dateTo: MON,
          leaveTypeId: 2,
          startPart: 'FULL',
          endPart: 'FULL',
        }),
      )
      await submitAndExpect(create, user, {
        leaveTypeId: 2,
        dateFrom: MON,
        dateTo: MON,
        startPart: 'FULL',
        endPart: 'FULL',
        note: undefined,
      })

      await user.selectOptions(screen.getByLabelText('Leave Type'), String(annualLeave.id))
      expect(screen.getByLabelText('Duration')).toHaveDisplayValue('Morning')
      await expectCharged('0.5')
      await submitAndExpect(create, user, {
        leaveTypeId: 1,
        dateFrom: MON,
        dateTo: MON,
        startPart: 'FIRST_HALF',
        endPart: 'FIRST_HALF',
        note: undefined,
      })
    })

    // MEDIA-UI-VAL-002. The clamp has to hold for everything that goes out, the preview included:
    // "Illegal part combinations are made unreachable in the UI and refused at the API -- both, not
    // either" (plan, decision 6). Narrowing a range back to one day must not preview the single
    // day's part over the range the debounced dates still hold.
    it('[P1] never asks the preview for a part combination the server refuses while the dates settle', async () => {
      const preview = mockPreviewServer()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, MON)
      await waitForFirstPreview()
      await user.selectOptions(screen.getByLabelText('Duration'), 'FIRST_HALF')
      await expectCharged('0.5')

      // A morning, widened to three days and narrowed back.
      setEndDate(WED)
      await expectCharged('3')
      setEndDate(MON)
      await expectCharged('0.5')

      // An afternoon start on three days, narrowed back to its first day.
      setEndDate(WED)
      await expectCharged('3')
      await user.selectOptions(screen.getByLabelText('First day'), 'SECOND_HALF')
      await expectCharged('2.5')
      setEndDate(MON)
      await expectCharged('0.5')

      const refused = preview.mock.calls
        .map(([payload]) => payload)
        .filter((payload) => serverRefusal(payload) != null)
      expect(refused).toEqual([])
    })
  })

  // MEDIA-UI-VAL-003. Both parts are in the preview's query key. Changing either one asks the
  // server again rather than showing the cached whole-day figure, and going back to an earlier
  // combination reuses that combination's answer.
  it('[P0] keys the preview on both parts, so a whole-day answer is never shown for a half-day request', async () => {
    const preview = mockPreviewServer()
    const user = userEvent.setup()
    const { queryClient } = renderModal()

    await chooseLeaveType(user, annualLeave)
    setDates(MON, WED)
    await expectCharged('3')
    expect(preview).toHaveBeenCalledTimes(1)

    // Hold the next answer so the moment between the part change and the server's reply is visible.
    const afternoonStart = deferred<PreviewLeaveRequestResponse>()
    preview.mockImplementationOnce(() => afternoonStart.promise)
    await user.selectOptions(screen.getByLabelText('First day'), 'SECOND_HALF')

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2))
    expect(preview).toHaveBeenLastCalledWith({
      dateFrom: MON,
      dateTo: WED,
      leaveTypeId: 1,
      startPart: 'SECOND_HALF',
      endPart: 'FULL',
    })
    expect(screen.queryByText('3 working days will be charged')).not.toBeInTheDocument()
    expect(screen.getByText('Calculating working days…')).toBeInTheDocument()
    expect(screen.getByTestId('submit-request-btn')).toBeDisabled()

    await act(async () => {
      afternoonStart.resolve(
        previewFor({ dateFrom: MON, dateTo: WED, leaveTypeId: 1, startPart: 'SECOND_HALF', endPart: 'FULL' }),
      )
    })
    await expectCharged('2.5')

    // The end part is in the key as well.
    await user.selectOptions(screen.getByLabelText('Last day'), 'FIRST_HALF')
    await expectCharged('2')
    expect(preview).toHaveBeenCalledTimes(3)
    expect(preview).toHaveBeenLastCalledWith({
      dateFrom: MON,
      dateTo: WED,
      leaveTypeId: 1,
      startPart: 'SECOND_HALF',
      endPart: 'FIRST_HALF',
    })

    // Back through the same combinations: each has its own cached answer, so no new request.
    await user.selectOptions(screen.getByLabelText('Last day'), 'FULL')
    await expectCharged('2.5')
    await user.selectOptions(screen.getByLabelText('First day'), 'FULL')
    await expectCharged('3')
    expect(preview).toHaveBeenCalledTimes(3)

    const cachedKeys = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['leave-requests', 'preview'] })
      .map((query) => query.queryKey)
    expect(cachedKeys).toEqual(
      expect.arrayContaining([
        ['leave-requests', 'preview', 2, MON, WED, 1, 'FULL', 'FULL'],
        ['leave-requests', 'preview', 2, MON, WED, 1, 'SECOND_HALF', 'FULL'],
        ['leave-requests', 'preview', 2, MON, WED, 1, 'SECOND_HALF', 'FIRST_HALF'],
      ]),
    )
  })

  describe('half-day refusals', () => {
    const contradictoryPartsMessage =
      'Those two halves do not describe a stretch of time. Leave that covers only a morning, or only an afternoon, has to start and end on the same day.'

    // The server's own detail is English and unlocalized; the translated sentence replaces it.
    async function expectPreviewRefusal(message: string, serverDetail: string) {
      const shown = await screen.findByText(message, undefined, { timeout: 2000 })
      expect(shown.closest('[role="alert"]')).not.toBeNull()
      expect(screen.queryByText(serverDetail, { exact: false })).not.toBeInTheDocument()
      expect(screen.getByTestId('submit-request-btn')).toBeDisabled()
    }

    // MEDIA-UI-VAL-004. half-day-not-allowed (400), met on the preview: names the leave type. The
    // client's list still says halves are allowed, as a list cached before the switch would.
    it('[P0] explains a refused half for a whole-days-only type by naming the type', async () => {
      const serverDetail = 'Annual Leave must be taken in whole days'
      vi.spyOn(apiClient, 'previewLeaveRequest').mockImplementation(async (payload) => {
        if (hasHalf(payload)) {
          throw new apiClient.ApiError(400, validationProblem('half-day-not-allowed', serverDetail))
        }
        return previewFor(payload)
      })
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, MON)
      await waitForFirstPreview()
      await user.selectOptions(screen.getByLabelText('Duration'), 'FIRST_HALF')

      await expectPreviewRefusal(`${isolate('Annual Leave')} must be taken in whole days.`, serverDetail)
    })

    // MEDIA-UI-VAL-004. half-day-on-non-working-day (400), met on the preview: names the date. A
    // Saturday-to-Monday request that starts "afternoon only" asks for half of a Saturday.
    it('[P0] explains a half day asked for on a weekend by naming the date', async () => {
      mockPreviewServer()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(SAT, NEXT_MON)
      await waitForFirstPreview()
      await user.selectOptions(screen.getByLabelText('First day'), 'SECOND_HALF')

      await expectPreviewRefusal(
        `${isolate('Jun 6, 2026')} is not a working day, so it cannot be taken as a half day.`,
        `${SAT} is not a working day`,
      )
    })

    // MEDIA-UI-VAL-004. contradictory-half-day-parts (400), met on the preview. The form never
    // offers such a pair, so the server is made to refuse one to prove the sentence exists.
    it('[P0] explains contradictory parts in its own words', async () => {
      const serverDetail = 'Leave that only covers the morning of its first day must end that same day'
      vi.spyOn(apiClient, 'previewLeaveRequest').mockImplementation(async (payload) => {
        if (hasHalf(payload)) {
          throw new apiClient.ApiError(
            400,
            validationProblem('contradictory-half-day-parts', serverDetail),
          )
        }
        return previewFor(payload)
      })
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, MON)
      await waitForFirstPreview()
      await user.selectOptions(screen.getByLabelText('Duration'), 'FIRST_HALF')

      await expectPreviewRefusal(contradictoryPartsMessage, serverDetail)
    })

    // MEDIA-UI-VAL-004. All four codes on submit -- the only place the 409 overlap can come from,
    // since the preview takes no write lock -- each rendering its own sentence.
    it.each([
      {
        code: 'leave-request-overlaps',
        error: new apiClient.ApiError(409, {
          type: 'https://leaveo.net/errors/leave-request-overlaps',
          title: 'Overlapping leave request',
          status: 409,
          detail: `You already have leave requested for ${TUE}`,
          code: 'leave-request-overlaps',
          date: TUE,
        }),
        message: `You already have leave requested for ${isolate('Jun 2, 2026')}. Change the dates, or cancel the other request first.`,
      },
      {
        code: 'half-day-not-allowed',
        error: new apiClient.ApiError(
          400,
          validationProblem('half-day-not-allowed', 'Annual Leave must be taken in whole days'),
        ),
        message: `${isolate('Annual Leave')} must be taken in whole days.`,
      },
      {
        code: 'half-day-on-non-working-day',
        error: new apiClient.ApiError(
          400,
          validationProblem(
            'half-day-on-non-working-day',
            `${MON} is not a working day, so it cannot be taken as a half day`,
            { date: MON },
          ),
        ),
        message: `${isolate('Jun 1, 2026')} is not a working day, so it cannot be taken as a half day.`,
      },
      {
        code: 'contradictory-half-day-parts',
        error: new apiClient.ApiError(
          400,
          validationProblem(
            'contradictory-half-day-parts',
            'Leave that only covers the afternoon of its last day must start that same day',
          ),
        ),
        message: contradictoryPartsMessage,
      },
    ])('[P0] renders its own sentence for $code on submit', async ({ error, message }) => {
      mockPreviewServer()
      vi.spyOn(apiClient, 'createLeaveRequest').mockRejectedValue(error)
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, WED)
      await expectCharged('3')
      await user.selectOptions(screen.getByLabelText('First day'), 'SECOND_HALF')
      await expectCharged('2.5')
      await user.click(screen.getByTestId('submit-request-btn'))

      const shown = await screen.findByText(message)
      expect(shown).toHaveAttribute('role', 'alert')
      expect(screen.queryByText(error.problem.detail as string, { exact: false })).not.toBeInTheDocument()
    })
  })

  describe('the result line and the submit button', () => {
    // MEDIA-UI-VAL-009. The charge and the excluded-days line take their plural form from the count,
    // so exactly one day reads in the singular and a half reads like any other fraction.
    it('[P1] reads one working day and one excluded day in the singular', async () => {
      mockPreviewServer()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(FRI, SAT)
      await waitFor(
        () =>
          expect(screen.getByTestId('working-day-result').textContent).toBe('1 working day will be charged'),
        { timeout: 2000 },
      )
      expect(screen.getByText('1 weekend/holiday day excluded from balance')).toBeInTheDocument()

      setEndDate(SUN)
      await waitFor(() =>
        expect(screen.getByText('2 weekend/holiday days excluded from balance')).toBeInTheDocument(),
      )
      expect(screen.getByTestId('working-day-result').textContent).toBe('1 working day will be charged')

      setDates(MON, MON)
      await expectCharged('1')
      await user.selectOptions(screen.getByLabelText('Duration'), 'FIRST_HALF')
      await expectCharged('0.5')
    })

    // MEDIA-UI-VAL-010. The preview prices dates debounced by 300 ms; submit sends the dates as typed.
    // Between a date change and the preview catching up, the charge on screen is the old range's, so
    // submit waits rather than sending a range whose charge nobody has seen.
    it('[P1] keeps submit disabled until the preview has caught up with a date change', async () => {
      mockPreviewServer()
      const create = mockCreateSuccess()
      const user = userEvent.setup()
      renderModal()

      await chooseLeaveType(user, annualLeave)
      setDates(MON, WED)
      await expectCharged('3')
      expect(screen.getByTestId('submit-request-btn')).toBeEnabled()

      setEndDate(TUE)
      expect(screen.getByTestId('working-day-result').textContent).toBe('3 working days will be charged')
      expect(screen.getByTestId('submit-request-btn')).toBeDisabled()

      await expectCharged('2')
      await submitAndExpect(create, user, {
        leaveTypeId: 1,
        dateFrom: MON,
        dateTo: TUE,
        startPart: 'FULL',
        endPart: 'FULL',
        note: undefined,
      })
    })
  })
})
