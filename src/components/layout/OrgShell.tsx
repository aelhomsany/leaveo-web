import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { getOrgNavItems } from '../../auth/rolePermissions'
import { useAuth } from '../../auth/useAuth'
import { usePendingApprovalCount } from '../../features/approvals/usePendingApprovalCount'
import { useApprovalCapability } from '../../features/approvals/useApprovalCapability'
import { useReportingCapability } from '../../features/reports/useReportingCapability'
import { NotificationBell } from '../../features/notifications/NotificationBell'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { AppHeader } from './AppHeader'
import { Sidebar } from './Sidebar'
import { UserMenu } from './UserMenu'
import { LanguageSwitcher } from './LanguageSwitcher'
import { SkipToMainLink } from './SkipToMainLink'
import { useMobileNavDrawer } from './useMobileNavDrawer'
import './org-shell.css'
import { BillingNotice } from '../../features/billing/BillingNotice'
import { SetupReturnNotice } from '../../features/onboarding/SetupReturnNotice'

export function OrgShell() {
  const { t, i18n } = useTranslation(['layout', 'common'])
  const { user, logout } = useAuth()
  const role = user?.role ?? 'EMPLOYEE'
  const capability = useApprovalCapability()
  const canReviewApprovals = capability.data?.canReviewApprovals ?? user?.canReviewApprovals
    ?? (role === 'MANAGER' || role === 'ORGANIZATION_ADMIN')
  const reportingCapability = useReportingCapability()
  // Restricted-recovery counts as access: exports created before billing lapsed stay collectable,
  // and hiding the nav made AC3's one sanctioned exception unreachable in the product.
  const canAccessReports =
    role === 'ORGANIZATION_ADMIN' &&
    (reportingCapability.data?.available === true ||
      reportingCapability.data?.recovery === true)
  const { data: pendingCountData } = usePendingApprovalCount()
  const pendingCount = pendingCountData?.count ?? 0
  const { navOpen, menuButtonRef, closeNav, toggleNav, onNavigate } =
    useMobileNavDrawer()
  const location = useLocation()

  const navItems = getOrgNavItems(role, canReviewApprovals, canAccessReports).map((item) => {
    const sourceKey = item.testId?.replace('nav-', '') ?? ''
    const key = sourceKey.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    const label = i18n.exists(`layout:nav.${key}`) ? t(`nav.${key}`) : item.label
    return item.path === '/approvals' && pendingCount > 0
      ? { ...item, label, badge: pendingCount }
      : { ...item, label }
  })

  return (
    <div className="org-shell" data-testid="org-shell">
      <SkipToMainLink inert={navOpen} />
      <div className="org-shell__body">
        <Sidebar
          variant="org"
          navItems={navItems}
          mobileOpen={navOpen}
          onNavigate={onNavigate}
        />
        {navOpen ? (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label={t('layout:header.closeNavigation')}
            data-testid="sidebar-backdrop"
            onMouseDown={(event) => event.preventDefault()}
            onClick={closeNav}
          />
        ) : null}
        <div className="org-shell__content">
          <AppHeader
            variant="org"
            contextLabel={user?.organizationName}
            actions={
              <>
                <LanguageSwitcher />
                <NotificationBell />
                <UserMenu
                  userName={user?.fullName ?? t('layout:header.userFallback')}
                  userRole={role}
                  profileImageUrl={user?.profileImageUrl}
                  onSignOut={logout}
                  variant="org"
                  languageSwitcher={<LanguageSwitcher compact />}
                />
              </>
            }
            navOpen={navOpen}
            menuButtonRef={menuButtonRef}
            onToggleNav={toggleNav}
            actionsInert={navOpen}
          />
          <BillingNotice />
          <SetupReturnNotice />
          <main
            id="main-content"
            className="org-shell__main"
            tabIndex={-1}
            {...(navOpen ? { inert: true } : {})}
          >
            <ErrorBoundary variant="route" key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  )
}
