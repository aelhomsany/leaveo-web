import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  commitImportJob,
  createImportJob,
  downloadImportArtifact,
  downloadImportTemplate,
  getImportJob,
  getImportRows,
  listImportJobs,
  uploadImportSource,
  type ImportTemplateKey,
} from '../../api/client'
import type {
  ImportJobResponse,
  ImportJobSummaryResponse,
  ImportRowResultPage,
} from '../../api/generated/types'
import { HorizontalScrollRegion } from '../../components/ui/HorizontalScrollRegion'
import { LoadingState } from '../../components/ui/LoadingState'
import { Modal } from '../../components/ui/Modal'
import { CheckIcon, CloseIcon, DownloadIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/useToast'
import './import.css'

const TEMPLATE_KEYS: ImportTemplateKey[] = ['PEOPLE_AND_ASSIGNMENTS', 'ENTITLEMENTS_AND_OPENING_BALANCES']

/** Statuses the worker is still moving through — the poll keeps running for these. */
const IN_FLIGHT_STATUSES = new Set(['MAPPED', 'VALIDATING', 'COMMITTING', 'COMMITTED', 'RECONCILING'])

/**
 * Every non-terminal status. The server allows one active job per Organization, so exactly one
 * history row can match; it is the job the wizard resumes into after a reload (Story 15.5 D3).
 */
const ACTIVE_STATUSES = new Set([
  'UPLOADED',
  'MAPPED',
  'VALIDATING',
  'DRY_RUN_READY',
  'COMMITTING',
  'COMMITTED',
  'RECONCILING',
])

const POLL_INTERVAL_MS = 2_000
/** Ten minutes at the poll interval, mirroring `ReportCenterPage`'s `EXPORT_POLL_LIMIT`. */
const POLL_LIMIT = 300
const ROW_PAGE_SIZE = 50

/** Mirrors the server-side hint in `import:upload.hint`; the server stays authoritative. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * What the OS file picker offers. Extensions first and MIME types after, because the picker on
 * Windows filters on the extensions while Safari only honours the types -- listing one without the
 * other greys out valid files on one platform or the other.
 */
const FILE_PICKER_ACCEPT = `.xlsx,.csv,${XLSX_MIME_TYPE},text/csv`

/**
 * `crypto.randomUUID` is undefined outside secure contexts and in older Safari, and this key is
 * minted during render — an unguarded call takes the whole page down rather than degrading.
 */
function newIdempotencyKey(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

type Phase =
  | 'start'
  | 'upload'
  | 'processing'
  | 'review'
  | 'committing'
  | 'result'
  | 'failed'
  | 'expired'

function phaseFor(job: ImportJobResponse | null): Phase {
  if (!job) return 'start'
  switch (job.status) {
    case 'UPLOADED':
      return 'upload'
    case 'MAPPED':
    case 'VALIDATING':
      return 'processing'
    case 'DRY_RUN_READY':
      return 'review'
    case 'COMMITTING':
    case 'COMMITTED':
    case 'RECONCILING':
      return 'committing'
    case 'RECONCILED':
      return 'result'
    case 'FAILED':
      return 'failed'
    case 'EXPIRED':
      return 'expired'
    default:
      return 'start'
  }
}

function isDeadLettered(
  job: { status?: string | null; workStatus?: string | null } | null | undefined,
): boolean {
  return job?.status === 'FAILED' && job?.workStatus === 'DEAD_LETTER'
}

/** The three things the user does, in order. Picking the template and handing over the file are
 *  one step, not two: choosing a file is what starts the import, so there is no screen in between.
 *  `processing` is validation *for* review, not a step of its own — a spinner that advances the
 *  tracker and then falls back would read as a rollback. Every terminal phase sits on the last
 *  step, success or not: the run is over either way. */
const STEPS = ['file', 'review', 'finish'] as const

function stepIndexFor(phase: Phase): number {
  switch (phase) {
    // `upload` shares step 0 with `start`: it is a recovery state now, not a step of its own --
    // the job exists but its file never landed, so the user is still on the step they thought
    // they were on.
    case 'start':
    case 'upload':
      return 0
    case 'processing':
    case 'review':
      return 1
    default:
      return 2
  }
}

/**
 * Mirrors `ImportTemplateCatalog.fileNameFor`. The endpoint sends the real name in
 * `Content-Disposition`, but a `fetch` reading the body as a Blob cannot see that header through
 * CORS-safelisting, so the save name is derived here from the same rule.
 */
function templateFileName(templateKey: ImportTemplateKey): string {
  return `leaveo-${templateKey.toLowerCase().replace(/_/g, '-')}-template.xlsx`
}

/** Same object-URL dance as `AuditHistoryPanel`'s exports: anchor, click, revoke on the next tick. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function formatTimestamp(isoTimestamp: string, locale: string): string {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp
  }
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ImportWizardPage() {
  const { t, i18n } = useTranslation(['import', 'common'])
  const { showToast } = useToast()
  const queryClient = useQueryClient()

  const [capabilityUnavailable, setCapabilityUnavailable] = useState(false)
  const [template, setTemplate] = useState<ImportTemplateKey>(TEMPLATE_KEYS[0])
  const [job, setJob] = useState<ImportJobResponse | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  // Which template's download is in flight, so only that button shows a pending state.
  const [templateDownloading, setTemplateDownloading] = useState<ImportTemplateKey | null>(null)
  // Set when `POST /imports` answers 409 import-job-active. That can now only mean a commit is
  // already landing -- an abandoned pre-commit job is superseded, not refused -- so the only
  // sensible recovery is to open the job that is mid-flight.
  const [activeJobConflict, setActiveJobConflict] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [rowPage, setRowPage] = useState(0)
  const [polls, setPolls] = useState(0)
  // The poll budget must be one counter: `refetchInterval` and the stall banner both read this.
  // Deriving the banner from a `useEffect` on `jobStatusQuery.data` never fired for the wedged
  // job it exists for, because structural sharing keeps deeply-equal data referentially identical.
  const pollsRef = useRef(0)
  const idempotencyKeyRef = useRef(newIdempotencyKey())
  const autoResumedRef = useRef(false)
  // "Start Import" is a file picker in disguise: one click, one native dialog, no interstitial
  // screen whose only content is the same input.
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const phase = phaseFor(job)
  const currentStep = stepIndexFor(phase)

  const templateLabel = (key: string | undefined): string =>
    key && i18nHasTemplate(key) ? t(`import:templates.${key}`) : (key ?? '—')

  const historyQuery = useQuery({
    queryKey: ['import-jobs', 'history'],
    queryFn: () => listImportJobs(undefined, 0, 10),
    retry: false,
  })

  useEffect(() => {
    if (historyQuery.error instanceof ApiError && historyQuery.error.problem.code === 'capability-unavailable') {
      setCapabilityUnavailable(true)
    }
  }, [historyQuery.error])

  const activeHistoryJob: ImportJobSummaryResponse | undefined = (historyQuery.data?.items ?? []).find(
    (item) => item.status != null && ACTIVE_STATUSES.has(item.status),
  )

  const openJobMutation = useMutation({
    mutationFn: (publicId: string) => getImportJob(publicId),
    onSuccess: (opened) => {
      setJob(opened)
      setOpenError(null)
      setStartError(null)
      setActiveJobConflict(false)
      setRowPage(0)
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.problem.code === 'capability-unavailable') {
        setCapabilityUnavailable(true)
        return
      }
      setOpenError(
        cause instanceof ApiError ? cause.problem.detail ?? t('import:errors.openFailed') : t('import:errors.openFailed'),
      )
    },
  })

  // Story 15.5 D3: server state, not component state, decides where the wizard starts. A reload
  // mid-job would otherwise land on `start`, where creating a job 409s forever.
  useEffect(() => {
    if (autoResumedRef.current || job || !activeHistoryJob?.publicId) return
    autoResumedRef.current = true
    openJobMutation.mutate(activeHistoryJob.publicId)
  }, [activeHistoryJob?.publicId, job, openJobMutation])

  const jobStatusQuery = useQuery({
    queryKey: ['import-job', job?.publicId],
    queryFn: async () => {
      const next = await getImportJob(job!.publicId!)
      pollsRef.current += 1
      setPolls(pollsRef.current)
      return next
    },
    enabled: Boolean(job?.publicId) && IN_FLIGHT_STATUSES.has(job?.status ?? ''),
    refetchInterval: (query) =>
      query.state.error || pollsRef.current >= POLL_LIMIT ? false : POLL_INTERVAL_MS,
    retry: false,
  })

  useEffect(() => {
    if (jobStatusQuery.data) {
      setJob(jobStatusQuery.data)
    }
  }, [jobStatusQuery.data])

  useEffect(() => {
    pollsRef.current = 0
    setPolls(0)
  }, [job?.publicId])

  const pollExhausted = polls >= POLL_LIMIT

  // Refresh the history list once a job settles into a terminal status the poll stops chasing.
  useEffect(() => {
    if (phase === 'result' || phase === 'failed') {
      void queryClient.invalidateQueries({ queryKey: ['import-jobs', 'history'] })
    }
  }, [phase, queryClient])

  const rowsQuery = useQuery({
    queryKey: ['import-job-rows', job?.publicId, rowPage],
    queryFn: () => getImportRows(job!.publicId!, rowPage, ROW_PAGE_SIZE),
    enabled: Boolean(job?.publicId) && phase === 'review',
  })

  const startMutation = useMutation({
    mutationFn: () => createImportJob(idempotencyKeyRef.current, template),
    onSuccess: (created) => {
      setJob(created)
      setStartError(null)
      setActiveJobConflict(false)
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.problem.code === 'capability-unavailable') {
        setCapabilityUnavailable(true)
        return
      }
      if (cause instanceof ApiError && cause.problem.code === 'import-job-active') {
        // The blocking job is discoverable from the list endpoint; refetch so the recovery
        // controls below render against a fresh row rather than a stale one.
        setActiveJobConflict(true)
        setStartError(null)
        void queryClient.invalidateQueries({ queryKey: ['import-jobs', 'history'] })
        return
      }
      setStartError(
        cause instanceof ApiError ? cause.problem.detail ?? t('import:errors.startFailed') : t('import:errors.startFailed'),
      )
    },
  })

  // Takes the id explicitly rather than reading `job`: the start flow uploads to a job created
  // milliseconds earlier, and `setJob` has not necessarily been applied by then.
  const uploadMutation = useMutation({
    mutationFn: (input: { publicId: string; file: File }) => uploadImportSource(input.publicId, input.file),
    onSuccess: (updated) => {
      setJob(updated)
      setUploadError(null)
      setFile(null)
    },
    onError: (cause) => {
      setUploadError(
        cause instanceof ApiError ? cause.problem.detail ?? t('import:errors.uploadFailed') : t('import:errors.uploadFailed'),
      )
    },
  })

  const commitMutation = useMutation({
    mutationFn: () => commitImportJob(job!.publicId!),
    onSuccess: (updated) => {
      setJob(updated)
      setConfirmOpen(false)
      setCommitError(null)
      showToast(t('import:actions.commit'))
    },
    onError: (cause) => {
      setConfirmOpen(false)
      setCommitError(
        cause instanceof ApiError ? cause.problem.detail ?? t('import:errors.commitFailed') : t('import:errors.commitFailed'),
      )
    },
  })

  /**
   * Create then upload, as one action behind one click. These were two screens: "Start Import"
   * created an empty job and landed on a page whose only content was the file input -- a step that
   * asked the user to confirm the thing they had just asked for. Now the click opens the native
   * picker and choosing a file does both calls, so the job is created only once there is a file to
   * put in it.
   *
   * `starting` is component state, not `isPending`: two chained `mutateAsync` calls leave the
   * React Query flags out of step under StrictMode's double-invoke, and a button stuck on
   * "Starting…" after a 200 is worse than no pending state at all.
   */
  const startWithFile = async (selected: File) => {
    setStarting(true)
    try {
      const created = await startMutation.mutateAsync().catch(() => null)
      if (!created?.publicId) return
      await uploadMutation
        .mutateAsync({ publicId: created.publicId, file: selected })
        .catch(() => undefined)
    } finally {
      setStarting(false)
    }
  }

  /**
   * Validates the picked file and, at the start of the wizard, immediately runs it. Returning the
   * file rather than only storing it keeps the recovery card (which uploads on its own button)
   * working off the same validation.
   */
  const chooseFile = (selected: File | null): File | null => {
    setUploadError(null)
    if (!selected) {
      setFile(null)
      return null
    }
    // SPA-only UX guard for the promise in `import:upload.hint` — a 200 MB file would otherwise
    // upload in full before the server rejected it. Row count stays server-side.
    //
    // A correct extension is enough on its own, and so is a recognised or absent media type: OS
    // pickers and browsers disagree wildly about what a workbook's `type` is, so neither half may
    // veto the other. This only filters the obvious mistakes early -- the server stays the
    // authority on what it will actually parse.
    const name = selected.name.toLowerCase()
    const looksSupported =
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      selected.type === 'text/csv' ||
      selected.type === 'application/csv' ||
      selected.type === XLSX_MIME_TYPE ||
      selected.type === ''
    if (!looksSupported) {
      setFile(null)
      setUploadError(t('import:upload.wrongType'))
      return null
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null)
      setUploadError(t('import:upload.tooLarge'))
      return null
    }
    setFile(selected)
    return selected
  }

  /**
   * The template download is deliberately not a `<a href>` to the endpoint: that request would
   * carry no bearer token, so it would 401 and the browser would save the problem+json body as an
   * `.xlsx`. Fetching it through the client and saving the Blob keeps auth and error handling.
   */
  const handleTemplateDownload = async (templateKey: ImportTemplateKey) => {
    setTemplateError(null)
    setTemplateDownloading(templateKey)
    try {
      saveBlob(await downloadImportTemplate(templateKey), templateFileName(templateKey))
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem.code === 'capability-unavailable') {
        setCapabilityUnavailable(true)
        return
      }
      setTemplateError(
        cause instanceof ApiError
          ? cause.problem.detail ?? t('import:errors.templateDownloadFailed')
          : t('import:errors.templateDownloadFailed'),
      )
    } finally {
      setTemplateDownloading(null)
    }
  }

  const handleDownload = async () => {
    if (!job?.publicId) return
    setDownloadError(null)
    try {
      const artifact = await downloadImportArtifact(job.publicId)
      // The recorded name is what was uploaded, extension included. The fallback reads the blob's
      // own content type rather than assuming CSV: a workbook saved as `.csv` opens as gibberish.
      const fallback = artifact.type === XLSX_MIME_TYPE ? 'import.xlsx' : 'import.csv'
      saveBlob(artifact, job.fileName ?? fallback)
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem.code === 'capability-unavailable') {
        setCapabilityUnavailable(true)
        return
      }
      setDownloadError(
        cause instanceof ApiError && cause.status === 410
          ? t('import:errors.evidenceExpired')
          : cause instanceof ApiError
            ? cause.problem.detail ?? t('import:errors.downloadFailed')
            : t('import:errors.downloadFailed'),
      )
    }
  }

  /**
   * Back, and "Start another import", are the same thing: put the wizard back at the beginning.
   * Nothing is sent -- the server never hears about it, and no event is recorded for a run the
   * user did not really begin. Whatever job was open stays open until the next import supersedes
   * it, which is the server's job and not a thing the user has to ask for.
   */
  const resetToStart = () => {
    setJob(null)
    setFile(null)
    setRowPage(0)
    setStartError(null)
    setUploadError(null)
    setCommitError(null)
    setDownloadError(null)
    setOpenError(null)
    setTemplateError(null)
    setActiveJobConflict(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    idempotencyKeyRef.current = newIdempotencyKey()
    // Without this the auto-resume effect would immediately reopen the job just stepped out of --
    // it is still non-terminal, so it is still the Organization's active history row. Going back
    // is an explicit choice and outranks the resume-on-reload convenience.
    autoResumedRef.current = true
    void queryClient.invalidateQueries({ queryKey: ['import-jobs', 'history'] })
  }

  if (capabilityUnavailable) {
    return (
      <div className="page page-wide import-page" data-testid="import-page">
        <header className="page-header">
          <h1 className="page-title">{t('import:title')}</h1>
        </header>
        <section className="card import-card" role="alert" data-testid="import-capability-unavailable">
          <div className="import-card-body">
            <h2 className="card-title">{t('import:capabilityUnavailable.title')}</h2>
            <p className="import-hint">{t('import:capabilityUnavailable.body')}</p>
          </div>
        </section>
      </div>
    )
  }

  const rows: ImportRowResultPage | undefined = rowsQuery.data
  const rowTotal = rows?.total ?? 0
  const rowSize = rows?.size && rows.size > 0 ? rows.size : ROW_PAGE_SIZE
  const rowTotalPages = Math.max(1, Math.ceil(rowTotal / rowSize))

  const historySummary = (historyQuery.data?.items ?? []).find((item) => item.publicId === job?.publicId)
  const reconciliationEntries = Object.entries(job?.reconciliation ?? {})
  // For `expired` the artifact is purged by definition — rendering the control there guarantees a
  // 410. The job's own
  // `artifactAvailable` is authoritative; the history row is only a fallback for a job we are
  // showing before its detail has loaded.
  const evidenceDownloadable =
    (phase === 'result' || phase === 'failed') &&
    (job?.artifactAvailable ?? historySummary?.artifactAvailable ?? false)

  // Only errors raised by the history row actions land under the history table: the start card
  // already renders `openError`, so routing by phase keeps it from appearing twice on one screen.
  const historyOpenError = phase === 'start' ? null : openError

  const templateDownloadButton = (templateKey: ImportTemplateKey, extraClass = '') => (
    <button
      type="button"
      className={`btn btn-outline btn-sm${extraClass ? ` ${extraClass}` : ''}`}
      aria-label={t('import:actions.downloadTemplateNamed', { template: templateLabel(templateKey) })}
      disabled={templateDownloading === templateKey}
      data-testid={`import-template-download-${templateKey}`}
      onClick={() => void handleTemplateDownload(templateKey)}
    >
      <DownloadIcon size={16} />
      {t('import:actions.downloadTemplate')}
    </button>
  )

  return (
    <div className="page page-wide import-page" data-testid="import-page">
      <header className="page-header">
        <div>
          <p className="import-eyebrow">{t('import:eyebrow')}</p>
          <h1 className="page-title">{t('import:title')}</h1>
          <p className="page-sub">{t('import:subtitle')}</p>
        </div>
      </header>

      <ol className="import-steps" aria-label={t('import:steps.label')} data-testid="import-steps">
        {STEPS.map((step, index) => {
          const state = index < currentStep ? 'done' : index === currentStep ? 'current' : 'todo'
          return (
            <li
              key={step}
              className="import-step"
              data-state={state}
              data-testid={`import-step-${step}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="import-step-marker" aria-hidden="true">
                {state === 'done' ? <CheckIcon size={14} /> : index + 1}
              </span>
              <span>{t(`import:steps.${step}`)}</span>
              {state === 'done' && <span className="sr-only">{t('import:steps.completed')}</span>}
            </li>
          )
        })}
      </ol>

      {phase === 'start' && (
        <section className="card import-card" aria-labelledby="import-start-title" data-testid="import-start">
          <div className="card-header">
            <div>
              <h2 className="card-title" id="import-start-title">
                {t('import:templates.heading')}
              </h2>
              <p className="import-card-subtitle">{t('import:templates.help')}</p>
            </div>
          </div>

          <div className="import-card-body">
            <fieldset className="import-template-fieldset">
              <legend className="import-template-legend">{t('import:templates.label')}</legend>
              <div className="import-template-grid">
                {TEMPLATE_KEYS.map((key) => {
                  const inputId = `import-template-${key}`
                  return (
                    <div
                      key={key}
                      className="import-template-option"
                      data-selected={template === key}
                      data-testid={`import-template-option-${key}`}
                    >
                      {/* The button is a sibling of the label, not a child: a button inside a label
                          is invalid markup and every download click would also flip the radio. */}
                      <label className="import-template-option-main" htmlFor={inputId}>
                        <input
                          id={inputId}
                          type="radio"
                          name="import-template"
                          value={key}
                          checked={template === key}
                          disabled={starting}
                          onChange={() => setTemplate(key)}
                        />
                        <span className="import-template-option-text">
                          <span className="import-template-option-name">{t(`import:templates.${key}`)}</span>
                          <span className="import-template-option-desc">
                            {t(`import:templates.descriptions.${key}`)}
                          </span>
                        </span>
                      </label>
                      {templateDownloadButton(key)}
                    </div>
                  )
                })}
              </div>
            </fieldset>

            {/* Says what the button will actually do, because it does something the label alone
                does not promise: it opens the picker. */}
            <p className="import-hint" id="import-start-hint">
              {t('import:upload.pickerHint')}
            </p>

            {templateError && (
              <p className="field-error" role="alert" data-testid="import-template-error">
                {templateError}
              </p>
            )}
            {startError && (
              <p className="field-error" role="alert">
                {startError}
              </p>
            )}
            {/* `chooseFile` rejects the wrong type or an oversized file before anything is sent,
                and that verdict now lands here rather than on a screen of its own. */}
            {uploadError && (
              <p className="field-error" role="alert" data-testid="import-start-file-error">
                {uploadError}
              </p>
            )}
            {activeJobConflict && (
              <div className="import-callout" role="alert" data-testid="import-active-conflict">
                <p>{t('import:activeJob.body')}</p>
                {activeHistoryJob?.publicId ? (
                  <div className="import-callout-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={openJobMutation.isPending}
                      data-testid="import-active-conflict-resume"
                      onClick={() => openJobMutation.mutate(activeHistoryJob.publicId!)}
                    >
                      {t('import:actions.resume')}
                    </button>
                  </div>
                ) : (
                  <p>{t('import:activeJob.notFound')}</p>
                )}
              </div>
            )}
            {openError && (
              <p className="field-error" role="alert">
                {openError}
              </p>
            )}
          </div>

          <div className="import-actions">
            {/* The input is the button. Keeping a real `<input type="file">` in the tree (rather
                than constructing one on click) is what lets tests and assistive tech reach it,
                but it is never the thing the user aims at. */}
            <input
              ref={fileInputRef}
              id="import-file"
              className="sr-only"
              type="file"
              accept={FILE_PICKER_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              data-testid="import-file-input"
              onChange={(event) => {
                const picked = chooseFile(event.target.files?.[0] ?? null)
                // Clear first: picking the same file twice in a row fires no `change` otherwise,
                // so a retry after a failed upload would silently do nothing.
                event.target.value = ''
                if (picked) void startWithFile(picked)
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={starting}
              aria-describedby="import-start-hint"
              data-testid="import-start-button"
              onClick={() => fileInputRef.current?.click()}
            >
              {starting ? t('import:actions.starting') : t('import:actions.start')}
            </button>
          </div>
        </section>
      )}

      {/* Recovery only: the job exists but its file never landed. The happy path never renders
          this -- creating and uploading are one action -- so it reads as "that did not go
          through, try the file again", not as a step of the wizard. */}
      {phase === 'upload' && job && (
        <section className="card import-card" aria-labelledby="import-upload-title" data-testid="import-upload">
          <div className="card-header">
            <div>
              <h2 className="card-title" id="import-upload-title">
                {t('import:upload.title')}
              </h2>
              <p className="import-card-subtitle">{templateLabel(job.templateKey)}</p>
            </div>
          </div>

          <div className="import-card-body">
            <p className="import-hint">{t('import:upload.recoveryHint')}</p>
            <div className="form-group">
              <label htmlFor="import-file-retry">{t('import:actions.chooseFile')}</label>
              <input
                id="import-file-retry"
                type="file"
                accept={FILE_PICKER_ACCEPT}
                aria-describedby="import-upload-hint"
                disabled={uploadMutation.isPending}
                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              />
              <p className="import-hint" id="import-upload-hint">
                {t('import:upload.hint')}
              </p>
            </div>
            {uploadError && (
              <p className="field-error" role="alert">
                {uploadError}
              </p>
            )}
            <div>
              <p className="import-hint">
                {t('import:upload.templateReminder', { template: templateLabel(job.templateKey) })}
              </p>
              {job.templateKey && i18nHasTemplate(job.templateKey)
                ? templateDownloadButton(job.templateKey as ImportTemplateKey)
                : null}
            </div>
            {templateError && (
              <p className="field-error" role="alert" data-testid="import-template-error">
                {templateError}
              </p>
            )}
          </div>

          <div className="import-actions">
            {/* Back leads, the action trails: the reading order matches the direction of travel,
                and the safe control is never the one under the thumb heading for Commit. */}
            <button
              type="button"
              className="btn btn-outline import-action-lead"
              data-testid="import-upload-back"
              onClick={resetToStart}
            >
              {t('import:actions.back')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || uploadMutation.isPending}
              onClick={() => {
                if (!file) {
                  setUploadError(t('import:upload.noFile'))
                  return
                }
                uploadMutation.mutate({ publicId: job.publicId!, file })
              }}
            >
              {uploadMutation.isPending ? t('import:actions.uploading') : t('import:actions.upload')}
            </button>
          </div>
        </section>
      )}

      {phase === 'processing' && (
        <LoadingState label={t('import:processing.title')} variant="block" testId="import-processing">
          <p>{t('import:processing.body')}</p>
          {jobStatusQuery.isError && (
            <p role="alert" data-testid="import-status-error">
              {t('import:errors.statusFailed')}
            </p>
          )}
          {pollExhausted && <p role="alert">{t('import:stalled')}</p>}
        </LoadingState>
      )}

      {phase === 'review' && job && (
        <section
          className="card import-card import-results"
          aria-labelledby="import-review-title"
          data-testid="import-review"
        >
          <div className="card-header">
            <div>
              <h2 className="card-title" id="import-review-title">
                {t('import:review.title')}
              </h2>
              <p className="import-card-subtitle">
                {t('import:review.summary', {
                  accepted: job.acceptedCount ?? 0,
                  rejected: job.rejectedCount ?? 0,
                  warnings: job.warningCount ?? 0,
                })}
              </p>
            </div>
          </div>

          {(job.rejectedCount ?? 0) > 0 && (
            <div className="import-card-body">
              <div className="import-callout" role="alert" data-testid="import-review-blocked">
                <p>{t('import:review.blockedByRejections')}</p>
                {/* Story 15.5: validation stages a rejected-row report in the outbox, and a
                    scheduled sweep mails it. Saying so here is the only place the uploader learns
                    the evidence is coming to them rather than living only on this screen. */}
                <p data-testid="import-review-rejection-emailed">{t('import:review.rejectionEmailed')}</p>
              </div>
            </div>
          )}

          {rowsQuery.isError ? (
            <div className="import-card-body">
              <p className="field-error" role="alert" data-testid="import-rows-error">
                {t('import:errors.rowsFailed')}
              </p>
            </div>
          ) : (rows?.items?.length ?? 0) === 0 ? (
            <div className="dashboard-empty-state" data-testid="import-review-empty">
              <p>{t('import:review.empty')}</p>
            </div>
          ) : (
            <HorizontalScrollRegion
              labelledBy="import-review-title"
              describedById="import-review-scroll-hint"
              testId="import-review-region"
            >
              <table className="dashboard-table table-compact">
                <thead>
                  <tr>
                    <th scope="col">{t('import:review.columns.row')}</th>
                    <th scope="col">{t('import:review.columns.line')}</th>
                    <th scope="col">{t('import:review.columns.status')}</th>
                    <th scope="col">{t('import:review.columns.errors')}</th>
                    <th scope="col">{t('import:review.columns.warnings')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows?.items ?? []).map((row, index) => (
                    <tr key={`${row.rowIndex}-${index}`} data-testid={`import-row-${row.rowIndex}`}>
                      <td>{row.rowIndex}</td>
                      <td>{row.sourceLine}</td>
                      <td>
                        {row.status && i18nHasRowStatus(row.status)
                          ? t(`import:rowStatus.${row.status}`)
                          : row.status}
                      </td>
                      <td dir="auto">{(row.errorCodes ?? []).join(', ')}</td>
                      <td dir="auto">{(row.warnings ?? []).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollRegion>
          )}

          <div className="import-pagination">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={rowPage === 0}
              onClick={() => setRowPage((page) => Math.max(0, page - 1))}
            >
              {t('import:review.pagination.previous')}
            </button>
            <p role="status" aria-live="polite" data-testid="import-review-pagination-status">
              {t('import:review.pagination.status', {
                page: rowPage + 1,
                totalPages: rowTotalPages,
                total: rowTotal,
              })}
            </p>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={rowPage + 1 >= rowTotalPages}
              onClick={() => setRowPage((page) => page + 1)}
            >
              {t('import:review.pagination.next')}
            </button>
          </div>

          <div className="import-actions">
            {/* Nothing has been written yet at this point, so leaving is free: the job keeps its
                place in the history table and the next import retires it. */}
            <button
              type="button"
              className="btn btn-outline import-action-lead"
              data-testid="import-review-back"
              onClick={resetToStart}
            >
              {t('import:actions.back')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={(job.rejectedCount ?? 0) > 0 || commitMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {t('import:actions.commit')}
            </button>
          </div>
          {commitError && (
            <div className="import-card-body">
              <p className="field-error" role="alert">
                {commitError}
              </p>
            </div>
          )}
        </section>
      )}

      {phase === 'committing' && (
        <LoadingState label={t('import:committing.title')} variant="block" testId="import-committing">
          <p>{t('import:committing.body')}</p>
          {jobStatusQuery.isError && (
            <p role="alert" data-testid="import-status-error">
              {t('import:errors.statusFailed')}
            </p>
          )}
          {pollExhausted && <p role="alert">{t('import:stalled')}</p>}
        </LoadingState>
      )}

      {(phase === 'result' || phase === 'failed' || phase === 'expired') && job && (
        <section className="card import-card" aria-labelledby="import-result-title" data-testid="import-result">
          <div className="card-header">
            <div>
              <h2 className="card-title" id="import-result-title">
                {phase === 'result'
                  ? t('import:result.title')
                  : isDeadLettered(job)
                    ? t('import:status.DEAD_LETTER')
                    : t(`import:status.${job.status}`)}
              </h2>
              <p className="import-card-subtitle">{templateLabel(job.templateKey)}</p>
            </div>
          </div>

          <div className="import-card-body">
            {phase === 'result' && (
              <>
                <p className="import-status-note">
                  {t('import:result.reconciledBody', { committed: job.committedCount ?? 0 })}
                </p>
                {reconciliationEntries.length > 0 && (
                  <dl className="import-reconciliation" data-testid="import-reconciliation">
                    {reconciliationEntries.map(([key, value]) => (
                      <div key={key}>
                        <dt>{i18nHasReconciliationKey(key) ? t(`import:result.reconciliationKeys.${key}`) : key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            )}
            {phase === 'failed' && (
              <div className="import-callout">
                {isDeadLettered(job) && (
                  <p role="alert" data-testid="import-dead-letter">
                    {t('import:result.deadLetterBody')}
                  </p>
                )}
                <p role="alert" dir="auto">
                  {job.failureReason
                    ? t('import:result.failureReason', { reason: job.failureReason })
                    : t('import:result.failedBody')}
                </p>
              </div>
            )}
            {/* Above the action bar, not below it: as a trailing line it read as the outcome of
                the button the user had just pressed. */}
            {!evidenceDownloadable && (
              <p className="import-failure-hint" data-testid="import-evidence-unavailable">
                {t('import:result.evidenceUnavailable')}
              </p>
            )}
            {downloadError && (
              <p className="field-error" role="alert">
                {downloadError}
              </p>
            )}
          </div>

          <div className="import-actions">
            {evidenceDownloadable && (
              <button
                type="button"
                className="btn btn-outline import-action-lead"
                onClick={() => void handleDownload()}
              >
                <DownloadIcon size={16} />
                {t('import:actions.downloadEvidence')}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={resetToStart}>
              {t('import:actions.startAnother')}
            </button>
          </div>
        </section>
      )}

      <section
        className="card import-card import-results"
        aria-labelledby="import-history-title"
        data-testid="import-history"
      >
        <div className="card-header">
          <h2 className="card-title" id="import-history-title">
            {t('import:history.title')}
          </h2>
        </div>
        {historyQuery.isError && !capabilityUnavailable && (
          <div className="import-card-body">
            <p className="field-error" role="alert">
              {t('import:errors.historyFailed')}
            </p>
          </div>
        )}
        {(historyQuery.data?.items?.length ?? 0) === 0 ? (
          <div className="dashboard-empty-state" data-testid="import-history-empty">
            <p>{t('import:history.empty')}</p>
          </div>
        ) : (
          <HorizontalScrollRegion
            labelledBy="import-history-title"
            describedById="import-history-scroll-hint"
            testId="import-history-region"
          >
            <table className="dashboard-table table-compact">
              <thead>
                <tr>
                  <th scope="col">{t('import:history.columns.fileName')}</th>
                  <th scope="col">{t('import:history.columns.template')}</th>
                  <th scope="col">{t('import:history.columns.status')}</th>
                  <th scope="col">{t('import:history.columns.counts')}</th>
                  <th scope="col">{t('import:history.columns.updatedAt')}</th>
                  <th scope="col">{t('import:history.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {(historyQuery.data?.items ?? []).map((item) => {
                  const active = item.status != null && ACTIVE_STATUSES.has(item.status)
                  return (
                    <tr key={item.publicId} data-testid={`import-history-row-${item.publicId}`}>
                      <td dir="auto">{item.fileName ?? '—'}</td>
                      <td>{templateLabel(item.templateKey)}</td>
                      <td>
                        {isDeadLettered(item) ? (
                          <span className="field-error" data-testid={`import-history-dead-letter-${item.publicId}`}>
                            {t('import:status.DEAD_LETTER')}
                          </span>
                        ) : item.status && i18nHasStatus(item.status) ? (
                          t(`import:status.${item.status}`)
                        ) : (
                          item.status
                        )}
                        {item.failureReason ? (
                          <span
                            className="import-failure-hint"
                            dir="auto"
                            data-testid={`import-history-failure-${item.publicId}`}
                          >
                            {item.failureReason}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {item.acceptedCount ?? 0} / {item.rejectedCount ?? 0}
                      </td>
                      <td>
                        {item.updatedAt ? (
                          <time dateTime={item.updatedAt}>{formatTimestamp(item.updatedAt, i18n.language)}</time>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <div className="import-row-actions">
                          {item.publicId && (active || item.status === 'RECONCILED' || item.status === 'FAILED') && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              disabled={openJobMutation.isPending}
                              data-testid={`import-history-open-${item.publicId}`}
                              onClick={() => openJobMutation.mutate(item.publicId!)}
                            >
                              {active ? t('import:actions.resume') : t('import:actions.open')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </HorizontalScrollRegion>
        )}
        {historyOpenError && (
          <div className="import-card-body">
            <p className="field-error" role="alert">
              {historyOpenError}
            </p>
          </div>
        )}
      </section>

      {confirmOpen && job && (
        <Modal labelledBy="import-confirm-title" onClose={() => setConfirmOpen(false)} closeOnBackdrop={false}>
          <div className="modal-header">
            <h2 className="modal-title" id="import-confirm-title">
              {t('import:confirm.title')}
            </h2>
            <button
              type="button"
              className="modal-close"
              aria-label={t('import:actions.close')}
              onClick={() => setConfirmOpen(false)}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="modal-body">
            <p>{t('import:confirm.body', { accepted: job.acceptedCount ?? 0 })}</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)}>
              {t('common:actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
            >
              {t('import:actions.confirmCommit')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** `i18n.exists` needs the instance; these guards stay inline so the row/status/reconciliation
 * maps never render a raw un-translated server key when the server adds one this page does not
 * know yet. */
const KNOWN_ROW_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'WARNING'])
const KNOWN_JOB_STATUSES = new Set([
  'UPLOADED', 'MAPPED', 'VALIDATING', 'DRY_RUN_READY', 'COMMITTING', 'COMMITTED',
  'RECONCILING', 'RECONCILED', 'FAILED', 'EXPIRED',
])
/** The union of both committers' `Difference.evidence()` maps. */
const KNOWN_RECONCILIATION_KEYS = new Set([
  'expectedRows', 'committedRows', 'effectRows', 'expectedUsers', 'actualUsers',
  'expectedInvitations', 'actualInvitations', 'expectedPolicyAssignments',
  'actualPolicyAssignments', 'actualLedgerEntries', 'difference',
])
function i18nHasRowStatus(status: string): boolean {
  return KNOWN_ROW_STATUSES.has(status)
}
function i18nHasStatus(status: string): boolean {
  return KNOWN_JOB_STATUSES.has(status)
}
function i18nHasReconciliationKey(key: string): boolean {
  return KNOWN_RECONCILIATION_KEYS.has(key)
}
function i18nHasTemplate(templateKey: string): boolean {
  return (TEMPLATE_KEYS as string[]).includes(templateKey)
}
