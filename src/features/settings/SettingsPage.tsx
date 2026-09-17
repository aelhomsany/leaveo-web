import {
  UNSAFE_DataRouterContext,
  useBeforeUnload,
  useBlocker,
  useSearchParams,
} from 'react-router-dom'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/useToast'
import { Modal } from '../../components/ui/Modal'
import { CloseIcon } from '../../components/ui/icons'
import { LeaveTypesCard } from './LeaveTypesCard'
import { TeamMembersCard } from './TeamMembersCard'
import { WorkforceGroupsWeekendsCard } from './WorkforceGroupsWeekendsCard'
import { CalendarPrivacySettingsPage } from './CalendarPrivacySettingsPage'
import { ChatNotificationsNotes, ChatNotificationsSettings } from './ChatNotificationsSettings'
import { SlackWorkspaceNotes, SlackWorkspaceSettings } from './SlackWorkspaceSettings'
import { OrganizationSettingsCard } from './OrganizationSettingsCard'
import {
  SettingsCategoryNav,
} from './SettingsCategoryNav'
import {
  SETTINGS_CATEGORIES,
  type SettingsCategory,
} from './settingsCategories'
import './group-tabs.css'
import './settings-ia.css'

const DEFAULT_CATEGORY: SettingsCategory = 'working-calendars'

type PendingSettingsTransition =
  | { type: 'category'; category: SettingsCategory }
  | { type: 'group'; groupId: number }

function categoryFromSearchParam(value: string | null): SettingsCategory {
  return SETTINGS_CATEGORIES.includes(value as SettingsCategory)
    ? (value as SettingsCategory)
    : DEFAULT_CATEGORY
}

function groupFromSearchParam(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null
  }
  const groupId = Number(value)
  return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null
}

type UnsavedSettingsModalProps = {
  onContinue: () => void
  onDiscard: () => void
}

function UnsavedSettingsModal({
  onContinue,
  onDiscard,
}: UnsavedSettingsModalProps) {
  const { t } = useTranslation('settings')

  return (
    <Modal
      labelledBy="settings-unsaved-discard-title"
      onClose={onContinue}
      closeOnBackdrop={false}
      testId="settings-unsaved-discard-modal"
    >
      <div className="modal-header">
        <h2 className="modal-title" id="settings-unsaved-discard-title">
          {t('unsaved.title')}
        </h2>
        <button
          type="button"
          className="modal-close"
          onClick={onContinue}
          aria-label={t('unsaved.continue')}
        >
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="modal-body">
        <p className="settings-unsaved-copy">{t('unsaved.copy')}</p>
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-outline"
          data-testid="settings-unsaved-continue-btn"
          onClick={onContinue}
        >
          {t('unsaved.continue')}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-testid="settings-unsaved-discard-btn"
          onClick={onDiscard}
        >
          {t('unsaved.discard')}
        </button>
      </div>
    </Modal>
  )
}

type SettingsRouteBlockerProps = {
  dirty: boolean
  hasPendingTransition: boolean
  // Set synchronously (refs update immediately, unlike state) right before an
  // app-driven navigation that must NOT be caught by this same blocker — e.g.
  // applying a category/group switch right after discardAllDrafts(), before
  // the `dirty` prop has had a chance to re-render as false. Consumed once.
  suppressNextBlockRef: MutableRefObject<boolean>
  onDiscard: () => void
}

function SettingsRouteBlocker({
  dirty,
  hasPendingTransition,
  suppressNextBlockRef,
  onDiscard,
}: SettingsRouteBlockerProps) {
  // Guards both leaving /settings entirely AND search-param-only changes on
  // /settings (category/group switches via browser Back/Forward bypass the
  // in-app requestCategory/requestGroup checks, since they mutate history
  // directly) — see Story 11.5 review.
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) => {
        if (suppressNextBlockRef.current) {
          suppressNextBlockRef.current = false
          return false
        }
        return (
          dirty &&
          (currentLocation.pathname !== nextLocation.pathname ||
            currentLocation.search !== nextLocation.search)
        )
      },
      [dirty, suppressNextBlockRef],
    ),
  )

  useEffect(() => {
    if (blocker.state === 'blocked' && hasPendingTransition) {
      // One dialog layer only (AC12): an in-app discard modal is already
      // open for a different transition. Refuse this navigation instead of
      // silently letting it bypass the open confirmation.
      blocker.reset()
    }
  }, [blocker, hasPendingTransition])

  if (blocker.state !== 'blocked' || hasPendingTransition) {
    return null
  }

  return (
    <UnsavedSettingsModal
      onContinue={() => blocker.reset()}
      onDiscard={() => {
        onDiscard()
        blocker.proceed()
      }}
    />
  )
}

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const dataRouterContext = useContext(UNSAFE_DataRouterContext)
  const [workingCalendarsDirty, setWorkingCalendarsDirty] = useState(false)
  const [peopleDirty, setPeopleDirty] = useState(false)
  const [leavePoliciesDirty, setLeavePoliciesDirty] = useState(false)
  const [discardSignal, setDiscardSignal] = useState(0)
  const [pendingTransition, setPendingTransition] =
    useState<PendingSettingsTransition | null>(null)
  // The group the Working-calendars card actually resolved to display. On a
  // deep-link without `?group=`, `requestedGroupId` stays null, so this is the
  // only reliable "currently active group" for the requestGroup no-op check.
  const [resolvedGroupId, setResolvedGroupId] = useState<number | null>(null)
  const suppressNextBlockRef = useRef(false)
  const slackAnnouncedRef = useRef(false)

  const categoryValue = searchParams.get('category')
  const activeCategory = categoryFromSearchParam(categoryValue)
  const requestedGroupId = groupFromSearchParam(searchParams.get('group'))
  const isDirty = workingCalendarsDirty || peopleDirty || leavePoliciesDirty

  const showSuccessToast = useCallback(
    (message: string) => showToast(message, 'success'),
    [showToast],
  )

  const showWarningToast = useCallback(
    (message: string) => showToast(message, 'warning'),
    [showToast],
  )

  const updateSearch = useCallback(
    (
      update: (next: URLSearchParams) => void,
      options?: { replace?: boolean },
    ) => {
      const next = new URLSearchParams(searchParams)
      update(next)
      setSearchParams(next, options)
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    const invalidCategory =
      categoryValue == null ||
      !SETTINGS_CATEGORIES.includes(categoryValue as SettingsCategory)
    // Strip `group` whenever it can't apply: wrong category, or present but
    // malformed/unresolvable even while on Working calendars (e.g. ?group=abc
    // should not linger in the URL bar forever).
    const groupNeedsCleanup =
      searchParams.has('group') &&
      (activeCategory !== 'working-calendars' ||
        groupFromSearchParam(searchParams.get('group')) == null)

    if (!invalidCategory && !groupNeedsCleanup) {
      return
    }

    // Self-healing URL correction — suppress the route blocker so a dirty draft
    // doesn't see a spurious "Discard unsaved changes?" for a navigation the
    // user never initiated.
    suppressNextBlockRef.current = true
    updateSearch(
      (next) => {
        if (invalidCategory) {
          next.set('category', DEFAULT_CATEGORY)
        }
        if (groupNeedsCleanup) {
          next.delete('group')
        }
      },
      { replace: true },
    )
  }, [activeCategory, categoryValue, searchParams, updateSearch])

  // Slack sends the browser back through the API's OAuth callback (Plan PUENTE B6), which
  // redirects here with `?slack=connected|error(&reason=...)`. Announce it once as a toast and
  // strip it so a reload never re-announces it. (The per-user calendar callback lands on the
  // My settings page instead — D-12.)
  useEffect(() => {
    const outcome = searchParams.get('slack')
    if (outcome == null || slackAnnouncedRef.current) {
      return
    }
    slackAnnouncedRef.current = true
    if (outcome === 'connected') {
      showSuccessToast(t('slack.callback.connected'))
    } else {
      showWarningToast(
        searchParams.get('reason') === 'access_denied'
          ? t('slack.callback.accessDenied')
          : t('slack.callback.failed'),
      )
    }
    suppressNextBlockRef.current = true
    updateSearch(
      (next) => {
        next.delete('slack')
        next.delete('reason')
      },
      { replace: true },
    )
  }, [searchParams, showSuccessToast, showWarningToast, t, updateSearch])

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!isDirty) {
          return
        }
        event.preventDefault()
        event.returnValue = ''
      },
      [isDirty],
    ),
  )

  const applyCategory = (category: SettingsCategory) => {
    updateSearch((next) => {
      next.set('category', category)
      if (category !== 'working-calendars') {
        next.delete('group')
      }
    })
  }

  const applyGroup = (groupId: number) => {
    updateSearch((next) => {
      next.set('category', 'working-calendars')
      next.set('group', String(groupId))
    })
  }

  // Returns whether the switch applied immediately (true) or was deferred
  // behind the unsaved-changes modal (false) — callers use this to decide
  // whether it's safe to move focus/scroll to the requested tab.
  const requestCategory = (category: SettingsCategory): boolean => {
    if (category === activeCategory) {
      return true
    }
    if (isDirty) {
      setPendingTransition({ type: 'category', category })
      return false
    }
    applyCategory(category)
    return true
  }

  const requestGroup = (groupId: number): boolean => {
    // Compare against the group actually on screen — `requestedGroupId` is null
    // until the URL carries `?group=`, so without the resolved fallback,
    // re-clicking the already-active tab would be treated as a real switch and
    // (while dirty) pop a discard modal that throws away the edit.
    if (groupId === (requestedGroupId ?? resolvedGroupId)) {
      return true
    }
    if (isDirty) {
      setPendingTransition({ type: 'group', groupId })
      return false
    }
    applyGroup(groupId)
    return true
  }

  const discardAllDrafts = useCallback(() => {
    setWorkingCalendarsDirty(false)
    setPeopleDirty(false)
    setLeavePoliciesDirty(false)
    setDiscardSignal((value) => value + 1)
  }, [])

  const discardAndProceed = () => {
    const transition = pendingTransition
    discardAllDrafts()
    setPendingTransition(null)
    if (transition?.type === 'category') {
      // discardAllDrafts()'s state updates haven't re-rendered yet, so the
      // blocker below would still see the stale `dirty=true` closure for
      // this same synchronous tick — suppress it for this one navigation.
      suppressNextBlockRef.current = true
      applyCategory(transition.category)
    } else if (transition?.type === 'group') {
      suppressNextBlockRef.current = true
      applyGroup(transition.groupId)
    }
  }

  const activeCopy = useMemo(
    () => ({
      title: t(`categories.items.${activeCategory}.title`),
      subtitle: t(`categories.items.${activeCategory}.subtitle`),
    }),
    [activeCategory, t],
  )

  return (
    <div className="page page-wide settings-page" data-testid="settings-page">
      <header className="page-header settings-page-header">
        <div>
          <p className="settings-page-eyebrow">{t('hero.eyebrow')}</p>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-sub">{t('subtitle')}</p>
        </div>
      </header>

      <div className="settings-ia-layout">
        <SettingsCategoryNav
          activeCategory={activeCategory}
          onSelect={requestCategory}
        />

        <main className="settings-active-region">
          <header className="settings-active-header">
            <span className="settings-active-index" aria-hidden="true">
              {String(SETTINGS_CATEGORIES.indexOf(activeCategory) + 1).padStart(2, '0')}
            </span>
            <div>
              <p className="settings-active-eyebrow">{t('categories.sectionLabel')}</p>
              <h2 className="settings-active-title" id={`settings-heading-${activeCategory}`}>
                {activeCopy.title}
              </h2>
              <p className="settings-active-subtitle">{activeCopy.subtitle}</p>
            </div>
          </header>

          <div
            id={`settings-panel-${activeCategory}`}
            className="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-category-${activeCategory}`}
            data-testid={`settings-panel-${activeCategory}`}
          >
            {activeCategory === 'organization' && <OrganizationSettingsCard />}

            {activeCategory === 'working-calendars' && (
              <WorkforceGroupsWeekendsCard
                requestedGroupId={requestedGroupId}
                discardSignal={discardSignal}
                onDirtyChange={setWorkingCalendarsDirty}
                onRequestGroupChange={requestGroup}
                onResolvedGroupId={(groupId) => {
                  setResolvedGroupId(groupId)
                  if (requestedGroupId != null && requestedGroupId !== groupId) {
                    // App-driven correction, not a user navigation — suppress
                    // the route blocker so a dirty draft isn't prompted.
                    suppressNextBlockRef.current = true
                    updateSearch((next) => next.set('group', String(groupId)), {
                      replace: true,
                    })
                  }
                }}
                onSuccess={showSuccessToast}
                onWarning={showWarningToast}
              />
            )}

            {activeCategory === 'calendar-privacy' && (
              <CalendarPrivacySettingsPage
                onSuccess={showSuccessToast}
                onWarning={showWarningToast}
              />
            )}

            {activeCategory === 'leave-policies' && (
              <LeaveTypesCard
                onDirtyChange={setLeavePoliciesDirty}
                onWarning={showWarningToast}
                onSuccess={showSuccessToast}
              />
            )}

            {activeCategory === 'people' && (
              <TeamMembersCard
                discardSignal={discardSignal}
                onDirtyChange={setPeopleDirty}
                onSuccess={showSuccessToast}
                onWarning={showWarningToast}
              />
            )}

            {activeCategory === 'integrations' && (
              /* Organization-wide integrations only (Organization Admin). The per-user cards — calendar
                 sync, calendar feed, "Your Slack" — moved to the My settings page (/my-settings) so every
                 role can reach them (Plan PUENTE D-12). Each card keeps its notes in a band beneath it. */
              <div className="panel-stack" data-testid="integrations-panel">
                <div className="panel-group">
                  <ChatNotificationsSettings
                    onSuccess={showSuccessToast}
                    onWarning={showWarningToast}
                  />
                  <div className="support-band">
                    <ChatNotificationsNotes />
                  </div>
                </div>
                <div className="panel-group">
                  <SlackWorkspaceSettings
                    onSuccess={showSuccessToast}
                    onWarning={showWarningToast}
                  />
                  <div className="support-band">
                    <SlackWorkspaceNotes />
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {pendingTransition && (
        <UnsavedSettingsModal
          onContinue={() => setPendingTransition(null)}
          onDiscard={discardAndProceed}
        />
      )}

      {dataRouterContext && (
        <SettingsRouteBlocker
          dirty={isDirty}
          hasPendingTransition={pendingTransition != null}
          suppressNextBlockRef={suppressNextBlockRef}
          onDiscard={discardAllDrafts}
        />
      )}
    </div>
  )
}
