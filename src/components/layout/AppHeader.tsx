import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import '../../i18n/config'
import { MenuIcon, CloseIcon, LeaveoLogo, LeaveoSymbol } from '../ui/icons'
import './app-header.css'

type AppHeaderProps = {
  variant: 'org' | 'admin'
  /**
   * Realm title shown beside the Leaveo symbol below 900px (admin shell). Without it the header
   * shows the full Leaveo logo, which already names the brand.
   */
  title?: string
  /** Organization name (org shell) or platform context label (admin shell); desktop only. */
  contextLabel?: string | null
  /** Right-aligned header actions (e.g. notification bell). */
  actions?: ReactNode
  /** Mobile drawer state — the hamburger is hidden on desktop. */
  navOpen: boolean
  onToggleNav: () => void
  /** Ref for focus return when the mobile drawer closes. */
  menuButtonRef?: RefObject<HTMLButtonElement | null>
  /** Removes non-drawer header actions from focus and accessibility scope while nav is open. */
  actionsInert?: boolean
}

/**
 * Persistent shell header (UX-DR29). Above the 900px breakpoint: white bar
 * right of the sidebar with the context label and actions. At or below 900px
 * it doubles as the mobile top bar: teal, hamburger for the drawer, brand.
 */
export function AppHeader({
  variant,
  title,
  contextLabel,
  actions,
  navOpen,
  onToggleNav,
  menuButtonRef,
  actionsInert = false,
}: AppHeaderProps) {
  const { t } = useTranslation(['layout', 'common'])
  return (
    <header
      className={`app-header app-header--${variant}`}
      data-testid="app-header"
    >
      <button
        ref={menuButtonRef}
        type="button"
        className="app-header-menu"
        aria-expanded={navOpen}
        aria-controls="app-sidebar"
        aria-label={navOpen ? t('header.closeNavigation') : t('header.openNavigation')}
        data-testid="shell-topbar-menu"
        onClick={onToggleNav}
      >
        {navOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
      </button>
      {title ? (
        <>
          <LeaveoSymbol size={24} tone="reverse" className="app-header-brand" />
          <span className="app-header-brand-title">{title}</span>
        </>
      ) : (
        <LeaveoLogo
          tone="reverse"
          width={132}
          label={t('common:brand.name')}
          className="app-header-brand"
        />
      )}
      {contextLabel ? (
        <span
          className="app-header-context"
          title={contextLabel}
          data-testid="app-header-context"
        >
          {contextLabel}
        </span>
      ) : null}
      <div
        className="app-header-actions"
        {...(actionsInert ? { inert: true, 'aria-hidden': true } : {})}
      >
        {actions}
      </div>
    </header>
  )
}
