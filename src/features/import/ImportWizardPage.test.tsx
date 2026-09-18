import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiClient from '../../api/client'
import { ApiError } from '../../api/client'
import type { ImportJobResponse, ImportJobSummaryResponse, ImportRowResultPage } from '../../api/generated/types'
import { ToastProvider } from '../../components/ui/ToastProvider'
import '../../i18n/config'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { ImportWizardPage } from './ImportWizardPage'

function job(overrides: Partial<ImportJobResponse> = {}): ImportJobResponse {
  return {
    publicId: 'job-1',
    templateKey: 'PEOPLE_AND_ASSIGNMENTS',
    status: 'UPLOADED',
    fileName: undefined,
    byteSize: 0,
    rowCount: 0,
    headerColumns: [],
    acceptedCount: 0,
    rejectedCount: 0,
    warningCount: 0,
    committedCount: 0,
    validationRevision: 1,
    reconciliation: {},
    failureReason: undefined,
    // Always present on the wire (primitive boolean); the download control gates on it, and an
    // EXPIRED job's purged artifact is exactly the case it exists to hide.
    artifactAvailable: true,
    createdAt: '2026-08-27T00:00:00Z',
    updatedAt: '2026-08-27T00:00:00Z',
    ...overrides,
  } as ImportJobResponse
}

/** A realistic /import-jobs list row: a resumable DRY_RUN_READY job, no worker diagnostics. */
function jobSummary(overrides: Partial<ImportJobSummaryResponse> = {}): ImportJobSummaryResponse {
  return {
    publicId: 'job-1',
    templateKey: 'PEOPLE_AND_ASSIGNMENTS',
    status: 'DRY_RUN_READY',
    workStatus: null,
    failureReason: null,
    fileName: 'people.csv',
    rowCount: 2,
    acceptedCount: 2,
    rejectedCount: 0,
    warningCount: 0,
    artifactAvailable: true,
    createdAt: '2026-08-27T00:00:00Z',
    updatedAt: '2026-08-27T00:05:00Z',
    ...overrides,
  }
}

function emptyRows(): ImportRowResultPage {
  return { items: [], page: 0, size: 100, total: 0 } as ImportRowResultPage
}

const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function csvFile(name = 'people.csv') {
  return new File(['a,b\n1,2'], name, { type: 'text/csv' })
}

/**
 * Start Import IS the file picker now: the button only opens it, and the create+upload pair fires
 * from the input's change event. A test therefore drives the whole start flow by handing the
 * hidden input a file — clicking the button alone does nothing in jsdom, which is exactly what it
 * does in a browser until a file comes back.
 */
async function startImport(user: ReturnType<typeof userEvent.setup>, file: File = csvFile()) {
  await screen.findByTestId('import-start')
  await user.upload(screen.getByTestId('import-file-input'), file)
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
            <ImportWizardPage />
          </AuthTestProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ImportWizardPage', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'listImportJobs').mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // IMPORT-UI-VAL-001: picking a file carries the wizard from the template picker straight to row
  // review, never representing UPLOADED/MAPPED as migration-complete (UX-DR71). The separate
  // upload screen is gone: choosing the file both creates the job and sends it.
  it('creates and uploads in one action, with no upload step in between', async () => {
    const user = userEvent.setup()
    const createSpy = vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    const uploadSpy = vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', fileName: 'people.csv', acceptedCount: 2, rejectedCount: 0, rowCount: 2 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue(emptyRows())

    renderPage()
    await startImport(user)

    await screen.findByTestId('import-review')
    // The job is created only once there is a file for it, and the upload screen never renders.
    expect(createSpy).toHaveBeenCalledWith(expect.any(String), 'PEOPLE_AND_ASSIGNMENTS')
    expect(uploadSpy).toHaveBeenCalledWith('job-1', expect.any(File))
    expect(screen.queryByTestId('import-upload')).not.toBeInTheDocument()
    // Never rendered as complete: UPLOADED/MAPPED never reach this assertion, and the review
    // screen itself is a distinct phase from the terminal result screen.
    expect(screen.queryByTestId('import-result')).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-002: row-error review table renders server-provided row evidence and blocks
  // commit while any row is rejected.
  it('renders row errors and warnings without raw cell content, and blocks commit on rejects', async () => {
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', acceptedCount: 1, rejectedCount: 1, warningCount: 0 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue({
      items: [
        { rowIndex: 0, sourceLine: 2, status: 'ACCEPTED', errorCodes: [], warnings: [] },
        { rowIndex: 1, sourceLine: 3, status: 'REJECTED', errorCodes: ['INVALID_ROLE'], warnings: [] },
      ],
      page: 0,
      size: 100,
      total: 2,
    } as ImportRowResultPage)

    const user = userEvent.setup()
    renderPage()
    await startImport(user)

    const review = await screen.findByTestId('import-review')
    expect(within(review).getByText('INVALID_ROLE')).toBeInTheDocument()
    expect(screen.getByTestId('import-review-blocked')).toBeInTheDocument()
    expect(within(review).getByRole('button', { name: /commit import/i })).toBeDisabled()
  })

  // IMPORT-UI-VAL-003: bounded poll reaches the terminal result, and download calls the artifact
  // endpoint.
  it('polls a committing job to RECONCILED and downloads the evidence', async () => {
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', acceptedCount: 1, rejectedCount: 0 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue(emptyRows())
    vi.spyOn(apiClient, 'commitImportJob').mockResolvedValue(job({ status: 'COMMITTING' }))
    vi.spyOn(apiClient, 'getImportJob').mockResolvedValue(
      job({ status: 'RECONCILED', committedCount: 1, reconciliation: { committedRows: 1 } }),
    )
    const downloadSpy = vi.spyOn(apiClient, 'downloadImportArtifact').mockResolvedValue(new Blob(['csv']))
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()

    const user = userEvent.setup()
    renderPage()
    await startImport(user)
    const review = await screen.findByTestId('import-review')
    await user.click(within(review).getByRole('button', { name: /commit import/i }))
    await user.click(screen.getByRole('button', { name: /confirm commit/i }))

    const result = await screen.findByTestId('import-result', {}, { timeout: 5000 })
    expect(within(result).getByTestId('import-reconciliation')).toBeInTheDocument()

    await user.click(within(result).getByRole('button', { name: /download source evidence/i }))
    await waitFor(() => expect(downloadSpy).toHaveBeenCalledWith('job-1'))
  })

  // IMPORT-UI-VAL-004: capability-unavailable renders distinct copy with no dead retry control.
  it('shows a capability-unavailable banner with no retry when DATA_IMPORT is denied', async () => {
    vi.spyOn(apiClient, 'listImportJobs').mockRejectedValue(
      new ApiError(403, { status: 403, code: 'capability-unavailable', title: 'Forbidden', detail: 'nope' }),
    )

    renderPage()

    const banner = await screen.findByTestId('import-capability-unavailable')
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('import-start')).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-005 (Story 15.5 D3): a reload mid-job resumes from SERVER state. The wizard
  // must open the organization's active job rather than landing on `start`, where every create
  // 409s under the one-active-job-per-Organization guard.
  it('resumes the organization active job on mount instead of starting at the template picker', async () => {
    vi.spyOn(apiClient, 'listImportJobs').mockResolvedValue({
      items: [jobSummary({ publicId: 'job-7' })],
      page: 0,
      size: 10,
      total: 1,
    })
    const getSpy = vi
      .spyOn(apiClient, 'getImportJob')
      .mockResolvedValue(job({ publicId: 'job-7', status: 'DRY_RUN_READY', acceptedCount: 2 }))
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue(emptyRows())

    renderPage()

    await screen.findByTestId('import-review')
    expect(getSpy).toHaveBeenCalledWith('job-7')
    expect(screen.queryByTestId('import-start')).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-006 (Story 15.5 D3): 409 import-job-active is never a dead end — the start card
  // surfaces the blocking job with a resume control. Only a commit already in flight can 409 now;
  // an abandoned pre-commit job is superseded server-side by the create instead of blocking it.
  it('offers resume when creating a job returns 409 import-job-active', async () => {
    vi.spyOn(apiClient, 'listImportJobs').mockResolvedValue({
      items: [jobSummary({ publicId: 'job-9', status: 'COMMITTING' })],
      page: 0,
      size: 10,
      total: 1,
    })
    // A COMMITTING job is active but not resumable-on-mount into an interactive phase; force the
    // conflict path by having the auto-resume read fail, then create.
    vi.spyOn(apiClient, 'getImportJob').mockRejectedValue(
      new ApiError(404, { status: 404, code: 'not-found', title: 'Not Found', detail: 'gone' }),
    )
    vi.spyOn(apiClient, 'createImportJob').mockRejectedValue(
      new ApiError(409, {
        status: 409,
        code: 'import-job-active',
        title: 'Conflict',
        detail: 'Organization already has an active import job',
      }),
    )
    const uploadSpy = vi.spyOn(apiClient, 'uploadImportSource')

    const user = userEvent.setup()
    renderPage()
    await startImport(user)

    const conflict = await screen.findByTestId('import-active-conflict')
    expect(within(conflict).getByTestId('import-active-conflict-resume')).toBeInTheDocument()
    // A create that 409s must not go on to upload the file to a job that was never made.
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /cancel import/i })).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-007 (Story 15.5 D4): a dead-lettered job reads differently from an ordinary
  // failure, and its failure reason is shown.
  it('distinguishes a dead-lettered job from an ordinary failure in the history table', async () => {
    vi.spyOn(apiClient, 'listImportJobs').mockResolvedValue({
      items: [
        jobSummary({
          publicId: 'job-dead',
          status: 'FAILED',
          workStatus: 'DEAD_LETTER',
          failureReason: 'Worker exceeded the retry ceiling',
          acceptedCount: 0,
          rejectedCount: 2,
          artifactAvailable: false,
        }),
        jobSummary({
          publicId: 'job-failed',
          status: 'FAILED',
          workStatus: 'IDLE',
          failureReason: null,
          fileName: 'other.csv',
          rowCount: 1,
          acceptedCount: 0,
          rejectedCount: 1,
          createdAt: '2026-08-26T00:00:00Z',
          updatedAt: '2026-08-26T00:05:00Z',
        }),
      ],
      page: 0,
      size: 10,
      total: 2,
    })

    renderPage()

    await screen.findByTestId('import-history-row-job-dead')
    expect(screen.getByTestId('import-history-dead-letter-job-dead')).toHaveTextContent(/retired/i)
    expect(screen.getByTestId('import-history-failure-job-dead')).toHaveTextContent(
      'Worker exceeded the retry ceiling',
    )
    // The ordinary failure keeps the plain status label, with no dead-letter marker.
    expect(screen.queryByTestId('import-history-dead-letter-job-failed')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('import-history-row-job-failed')).getByText('Failed'),
    ).toBeInTheDocument()
  })

  // IMPORT-UI-VAL-008: the evidence download is gated on a terminal state that still has an
  // artifact — for an EXPIRED job the artifact is purged by definition, so the control would be
  // guaranteed to 410.
  it('hides the evidence download for an expired job', async () => {
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(job({ status: 'EXPIRED' }))

    const user = userEvent.setup()
    renderPage()
    await startImport(user)

    const result = await screen.findByTestId('import-result')
    expect(within(result).queryByRole('button', { name: /download source evidence/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('import-evidence-unavailable')).toBeInTheDocument()
  })

  // IMPORT-UI-VAL-009: SPA-only guard for the "up to 10 MB" promise in the picker hint. This is
  // a UX rule with no server mirror in Vitest — the server stays authoritative on the real limit.
  // Now that the file is picked before the job exists, a rejected file must also leave no job
  // behind: creating one would burn the Organization's single open slot on a file never sent.
  it('rejects an oversized file client-side without creating a job or calling upload', async () => {
    const createSpy = vi.spyOn(apiClient, 'createImportJob')
    const uploadSpy = vi.spyOn(apiClient, 'uploadImportSource')

    const user = userEvent.setup()
    renderPage()

    const oversized = new File(['x'], 'huge.csv', { type: 'text/csv' })
    Object.defineProperty(oversized, 'size', { value: 11 * 1024 * 1024 })
    await startImport(user, oversized)

    const start = screen.getByTestId('import-start')
    expect(await within(start).findByTestId('import-start-file-error')).toHaveTextContent(
      /larger than 10 MB/i,
    )
    expect(createSpy).not.toHaveBeenCalled()
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(screen.queryByTestId('import-upload')).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-010: a failed rows load must not read as "no rows to review" — the user would
  // otherwise commit blind.
  it('surfaces a rows-load failure instead of the empty-review state', async () => {
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', acceptedCount: 2, rejectedCount: 0 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockRejectedValue(
      new ApiError(500, { status: 500, code: 'internal', title: 'Error', detail: 'boom' }),
    )

    const user = userEvent.setup()
    renderPage()
    await startImport(user)

    expect(await screen.findByTestId('import-rows-error')).toBeInTheDocument()
    expect(screen.queryByTestId('import-review-empty')).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-011: each template offers its own download, and the saved name matches
  // `ImportTemplateCatalog.fileNameFor` — a file saved as `blob` or `download` is one the user
  // cannot find again, which defeats the point of shipping a template at all.
  it('downloads each template workbook under its catalog file name', async () => {
    const templateSpy = vi.spyOn(apiClient, 'downloadImportTemplate').mockResolvedValue(new Blob(['h1,h2']))
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    const savedAs: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      savedAs.push(this.download)
    })

    const user = userEvent.setup()
    renderPage()
    const start = await screen.findByTestId('import-start')

    await user.click(within(start).getByTestId('import-template-download-PEOPLE_AND_ASSIGNMENTS'))
    await waitFor(() => expect(templateSpy).toHaveBeenCalledWith('PEOPLE_AND_ASSIGNMENTS'))
    await user.click(within(start).getByTestId('import-template-download-ENTITLEMENTS_AND_OPENING_BALANCES'))
    await waitFor(() => expect(templateSpy).toHaveBeenCalledWith('ENTITLEMENTS_AND_OPENING_BALANCES'))

    expect(savedAs).toEqual([
      'leaveo-people-and-assignments-template.xlsx',
      'leaveo-entitlements-and-opening-balances-template.xlsx',
    ])
    // Downloading a template must not start a job or move the wizard off the picker.
    expect(screen.getByTestId('import-start')).toBeInTheDocument()
  })

  // IMPORT-UI-VAL-012: the download button sits next to the radio it belongs to. Clicking it must
  // not select that template — a nested button inside the label would, silently switching the
  // import the user is about to run.
  it('keeps the template selection unchanged when the other template is downloaded', async () => {
    vi.spyOn(apiClient, 'downloadImportTemplate').mockResolvedValue(new Blob(['h1,h2']))
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createSpy = vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))

    const user = userEvent.setup()
    renderPage()
    const start = await screen.findByTestId('import-start')

    await user.click(within(start).getByTestId('import-template-download-ENTITLEMENTS_AND_OPENING_BALANCES'))
    await user.upload(screen.getByTestId('import-file-input'), csvFile())

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.any(String), 'PEOPLE_AND_ASSIGNMENTS'),
    )
  })

  // IMPORT-UI-VAL-013: a failed template download reports itself. Saving a problem+json body under
  // the template's own name is the silent failure this guards against -- Excel would open it as a
  // damaged workbook, which reads as a bug in the template rather than as a failed request.
  it('surfaces a failed template download instead of saving an error body', async () => {
    vi.spyOn(apiClient, 'downloadImportTemplate').mockRejectedValue(
      new ApiError(500, { status: 500, code: 'internal', title: 'Error', detail: 'template unavailable' }),
    )
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    const user = userEvent.setup()
    renderPage()
    const start = await screen.findByTestId('import-start')
    await user.click(within(start).getByTestId('import-template-download-PEOPLE_AND_ASSIGNMENTS'))

    expect(await screen.findByTestId('import-template-error')).toHaveTextContent(/template unavailable/i)
    expect(clickSpy).not.toHaveBeenCalled()
    // The button recovers: a transient failure must not strand the only route to the template.
    expect(within(start).getByTestId('import-template-download-PEOPLE_AND_ASSIGNMENTS')).toBeEnabled()
  })

  // IMPORT-UI-VAL-014: the progress tracker names where the user is. Exactly one step is current,
  // and the steps behind it are marked done rather than merely un-highlighted. Choosing the
  // template and choosing the file are one step, so the tracker is three long, not four.
  it('advances the step tracker from choosing a file to reviewing rows', async () => {
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', acceptedCount: 2, rejectedCount: 0 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue(emptyRows())

    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('import-start')

    expect(screen.getAllByTestId(/^import-step-/)).toHaveLength(3)
    expect(screen.getByTestId('import-step-file')).toHaveAttribute('data-state', 'current')
    expect(screen.getByTestId('import-step-review')).toHaveAttribute('data-state', 'todo')

    await startImport(user)
    await screen.findByTestId('import-review')

    expect(screen.getByTestId('import-step-file')).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('import-step-review')).toHaveAttribute('data-state', 'current')
    expect(screen.getAllByTestId(/^import-step-/).filter((step) => step.getAttribute('aria-current') === 'step')).toHaveLength(1)
  })

  // IMPORT-UI-VAL-015 (Story 15.5): rejections block the commit, and the rejected-row report is
  // emailed rather than shown in full. The reviewer has to be told that, or the only path they
  // see is re-reading a paginated table.
  it('tells the reviewer the rejected rows are being emailed', async () => {
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', acceptedCount: 3, rejectedCount: 2 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue(emptyRows())

    const user = userEvent.setup()
    renderPage()
    await startImport(user)

    const review = await screen.findByTestId('import-review')
    expect(within(review).getByTestId('import-review-rejection-emailed')).toHaveTextContent(/emailed to you/i)
    expect(within(review).getByRole('button', { name: /commit import/i })).toBeDisabled()
  })

  // IMPORT-UI-VAL-016: Back is navigation, not an outcome. Leaving the review screen must reach
  // no endpoint at all — the job the user never committed is retired server-side by the next
  // create, so there is nothing here worth recording as a decision they made.
  it('leaves the review screen through Back without calling any endpoint', async () => {
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', acceptedCount: 2, rejectedCount: 0 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue(emptyRows())
    const commitSpy = vi.spyOn(apiClient, 'commitImportJob')
    const getSpy = vi.spyOn(apiClient, 'getImportJob')

    const user = userEvent.setup()
    renderPage()
    await startImport(user)

    const review = await screen.findByTestId('import-review')
    expect(within(review).queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    await user.click(within(review).getByTestId('import-review-back'))

    await screen.findByTestId('import-start')
    expect(screen.queryByTestId('import-review')).not.toBeInTheDocument()
    expect(commitSpy).not.toHaveBeenCalled()
    expect(getSpy).not.toHaveBeenCalled()
  })

  // IMPORT-UI-VAL-017: Back at the start of the wizard must stay backed out. The job is still the
  // Organization's newest non-terminal row, so the resume-on-mount convenience would otherwise
  // drag the user straight back into the screen they just left.
  it('does not auto-resume the job the user just backed out of', async () => {
    vi.spyOn(apiClient, 'listImportJobs').mockResolvedValue({
      items: [jobSummary()],
      page: 0,
      size: 10,
      total: 1,
    })
    vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    vi.spyOn(apiClient, 'uploadImportSource').mockResolvedValue(
      job({ status: 'DRY_RUN_READY', acceptedCount: 2, rejectedCount: 0 }),
    )
    vi.spyOn(apiClient, 'getImportRows').mockResolvedValue(emptyRows())

    const user = userEvent.setup()
    renderPage()
    await startImport(user)

    const review = await screen.findByTestId('import-review')
    await user.click(within(review).getByTestId('import-review-back'))

    await screen.findByTestId('import-start')
    // The abandoned job stays listed and resumable by name; it just no longer grabs the wizard.
    expect(await screen.findByTestId('import-history-row-job-1')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('import-review')).not.toBeInTheDocument())
  })

  // IMPORT-UI-VAL-018: no cancel control survives anywhere on the screen, including the row
  // actions in the history table, where it used to sit beside Resume.
  it('offers no cancel control in the history table', async () => {
    vi.spyOn(apiClient, 'listImportJobs').mockResolvedValue({
      items: [jobSummary({ publicId: 'job-open' })],
      page: 0,
      size: 10,
      total: 1,
    })
    vi.spyOn(apiClient, 'getImportJob').mockRejectedValue(
      new ApiError(404, { status: 404, code: 'not-found', title: 'Not Found', detail: 'gone' }),
    )

    renderPage()

    const row = await screen.findByTestId('import-history-row-job-open')
    expect(within(row).getByTestId('import-history-open-job-open')).toBeInTheDocument()
    expect(screen.queryByTestId('import-history-cancel-job-open')).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-019: the pre-flight guard must not be stricter than the server it fronts. OS
  // pickers report a workbook's media type inconsistently -- the xlsx type on some platforms, an
  // empty string on others -- so a guard that trusted `type` alone would block valid workbooks and
  // show a client-side error the server never asked for. SPA-only: there is no server mirror for a
  // file that is never sent.
  it.each([
    ['its own media type', XLSX_MEDIA_TYPE],
    ['no media type at all', ''],
  ])('uploads a workbook the picker reports with %s', async (_reported, type) => {
    const createSpy = vi.spyOn(apiClient, 'createImportJob').mockResolvedValue(job({ status: 'UPLOADED' }))
    const uploadSpy = vi
      .spyOn(apiClient, 'uploadImportSource')
      .mockResolvedValue(job({ status: 'DRY_RUN_READY', acceptedCount: 2, rejectedCount: 0 }))

    const user = userEvent.setup()
    renderPage()
    await startImport(user, new File(['PK'], 'people.xlsx', { type }))

    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    await waitFor(() => expect(uploadSpy).toHaveBeenCalled())
    expect(screen.queryByTestId('import-start-file-error')).not.toBeInTheDocument()
  })

  // IMPORT-UI-VAL-020: the picker offers both accepted formats. Listing only one of them greys out
  // files the server would take, and the user has no way to tell that from an unsupported file.
  it('offers both accepted formats to the file picker', async () => {
    renderPage()
    await screen.findByTestId('import-start')

    const accept = screen.getByTestId('import-file-input').getAttribute('accept') ?? ''
    expect(accept).toContain('.xlsx')
    expect(accept).toContain('.csv')
    expect(accept).toContain(XLSX_MEDIA_TYPE)
    expect(accept).toContain('text/csv')
  })

  // IMPORT-UI-VAL-021: `accept` is a filter on the picker, not a guarantee -- a drag-and-drop or a
  // picker that ignores it still hands the input whatever the user chose. The change handler must
  // refuse it on its own and leave no job behind. Driven with a raw change event on purpose:
  // userEvent.upload applies `accept` itself, so it can never deliver the file this guard is for.
  it('refuses a plainly unsupported file without creating a job', async () => {
    const createSpy = vi.spyOn(apiClient, 'createImportJob')

    renderPage()
    await screen.findByTestId('import-start')

    const input = screen.getByTestId('import-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['{}'], 'people.json', { type: 'application/json' })] } })

    const start = screen.getByTestId('import-start')
    expect(await within(start).findByTestId('import-start-file-error')).toHaveTextContent(/\.xlsx/)
    expect(createSpy).not.toHaveBeenCalled()
  })
})
