import { NavLink } from 'react-router-dom'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import '../../i18n/config'
import { LeaveoLogo, LeaveoSymbol, type IconProps } from '../ui/icons'
import './sidebar.css'

export type NavItem = {
  label: string
  path: string
  icon?: ComponentType<IconProps>
  end?: boolean
  testId?: string
  badge?: number
}

type SidebarProps = {
  variant: 'org' | 'admin'
  navItems: NavItem[]
  logoTitle?: string
  logoSubtitle?: string
  /** Mobile drawer state — the sidebar is always visible on desktop. */
  mobileOpen?: boolean
  /** Called when a nav link is followed, so the mobile drawer can close. */
  onNavigate?: () => void
}

export function Sidebar({
  variant,
  navItems,
  logoTitle,
  logoSubtitle,
  mobileOpen = false,
  onNavigate,
}: SidebarProps) {
  const { t } = useTranslation(['layout', 'common'])
  const variantClass = variant === 'org' ? 'sidebar--org' : 'sidebar--admin'

  return (
    <aside
      id="app-sidebar"
      className={`sidebar ${variantClass}${mobileOpen ? ' sidebar--open' : ''}`}
      data-testid="sidebar"
    >
      <div className="sidebar-logo">
        {logoTitle ? (
          <>
            <LeaveoSymbol size={32} tone="reverse" />
            <div>
              <div className="sidebar-logo-text">{logoTitle}</div>
              {logoSubtitle ? <div className="sidebar-logo-sub">{logoSubtitle}</div> : null}
            </div>
          </>
        ) : (
          <LeaveoLogo tone="reverse" label={t('common:brand.name')} />
        )}
      </div>

      <nav className="sidebar-nav" aria-label={t('navigation.main')}>
        {navItems.map((item) => {
          const badge = item.badge
          const accessibleLabel =
            badge != null && badge > 0
              ? t('layout:navigation.pending', { label: item.label, count: badge })
              : item.label
          const Icon = item.icon

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `sidebar-nav-item${isActive ? ' active' : ''}`
              }
              end={item.end ?? item.path === '/'}
              data-testid={item.testId}
              aria-label={accessibleLabel}
              onClick={onNavigate}
            >
              {Icon && (
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
              )}
              <span className="sidebar-nav-label">{item.label}</span>
              {badge != null && badge > 0 ? (
                <span className="sidebar-nav-badge" data-testid={`${item.testId}-badge`}>
                  {badge}
                </span>
              ) : null}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
