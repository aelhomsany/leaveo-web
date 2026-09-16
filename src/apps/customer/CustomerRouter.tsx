import { Suspense, lazy, type ReactElement, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Navigate,
  Route,
  RouterProvider,
  Routes,
  createBrowserRouter,
} from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthProvider'
import { OrgShell } from '../../components/layout/OrgShell'
import { LoginPage } from '../../features/login/LoginPage'
import { RegistrationHandoffPage } from '../../features/login/RegistrationHandoffPage'
import { PagePlaceholder } from '../../features/shared/PagePlaceholder'
import { usePageTitle } from '../../hooks/usePageTitle'
import { ProtectedRoute } from '../../routes/ProtectedRoute'
import { RoleGuard } from '../../routes/RoleGuard'

const MyLeavesPage = lazy(() =>
  import('../../features/my-leaves/MyLeavesPage').then((module) => ({
    default: module.MyLeavesPage,
  })),
)
const RequestContextPage = lazy(() =>
  import('../../features/leave-requests/RequestContextPage').then((module) => ({
    default: module.RequestContextPage,
  })),
)
const ForgotPasswordPage = lazy(() =>
  import('../../features/login/ForgotPasswordPage').then((module) => ({
    default: module.ForgotPasswordPage,
  })),
)
const ResetPasswordPage = lazy(() =>
  import('../../features/login/ResetPasswordPage').then((module) => ({
    default: module.ResetPasswordPage,
  })),
)
const AcceptInvitationPage = lazy(() =>
  import('../../features/login/AcceptInvitationPage').then((module) => ({
    default: module.AcceptInvitationPage,
  })),
)
const TeamCalendarPage = lazy(() =>
  import('../../features/calendar/TeamCalendarPage').then((module) => ({
    default: module.TeamCalendarPage,
  })),
)
const SettingsPage = lazy(() =>
  import('../../features/settings/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
)
const PolicySettingsPage = lazy(() =>
  import('../../features/settings/PolicySettingsPage').then((module) => ({
    default: module.PolicySettingsPage,
  })),
)
const ProfilePage = lazy(() =>
  import('../../features/profile/ProfilePage').then((module) => ({
    default: module.ProfilePage,
  })),
)
const MySettingsPage = lazy(() =>
  import('../../features/my-settings/MySettingsPage').then((module) => ({
    default: module.MySettingsPage,
  })),
)
const ApprovalsPage = lazy(() =>
  import('../../features/approvals/ApprovalsPage').then((module) => ({
    default: module.ApprovalsPage,
  })),
)
const PlanAndBillingPage = lazy(() =>
  import('../../features/billing/PlanAndBillingPage').then((module) => ({
    default: module.PlanAndBillingPage,
  })),
)
const OnboardingPage = lazy(() =>
  import('../../features/onboarding/OnboardingPage').then((module) => ({
    default: module.OnboardingPage,
  })),
)
const ReportCatalogPage = lazy(() =>
  import('../../features/reports/ReportCatalogPage').then((module) => ({
    default: module.ReportCatalogPage,
  })),
)
const ReportCenterPage = lazy(() =>
  import('../../features/reports/ReportCenterPage').then((module) => ({
    default: module.ReportCenterPage,
  })),
)
const ImportWizardPage = lazy(() =>
  import('../../features/import/ImportWizardPage').then((module) => ({
    default: module.ImportWizardPage,
  })),
)
const CorrectionsPage = lazy(() =>
  import('../../features/corrections/CorrectionsPage').then((module) => ({
    default: module.CorrectionsPage,
  })),
)

function RouteFallback() {
  const { t } = useTranslation('common')
  return (
    <div className="page" aria-busy="true">
      <p className="body-text">{t('loading')}</p>
    </div>
  )
}

function TitledRoute({ titleKey, children }: { titleKey: string; children: ReactElement }) {
  const { t } = useTranslation('common')
  usePageTitle(t(titleKey))
  return children
}

function titled(titleKey: string, element: ReactElement) {
  return <TitledRoute titleKey={titleKey}>{element}</TitledRoute>
}

export function CustomerRoutes() {
  const { t } = useTranslation('common')
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={titled('routes.signIn', <LoginPage />)} />
        <Route
          path="/forgot-password"
          element={titled('routes.forgotPassword', <ForgotPasswordPage />)}
        />
        <Route
          path="/reset-password"
          element={titled('routes.resetPassword', <ResetPasswordPage />)}
        />
        <Route
          path="/accept-invitation"
          element={titled('routes.acceptInvitation', <AcceptInvitationPage />)}
        />

        <Route element={<ProtectedRoute />}>
          <Route element={<OrgShell />}>
            <Route path="/profile" element={titled('routes.profile', <ProfilePage />)} />
          </Route>
          <Route element={<RoleGuard shell="org" />}>
            <Route element={<OrgShell />}>
              {/* The Dashboard merged into /my-leaves (2026-09-01); the Team Calendar is
                  the landing screen. Keep '/' as a redirect so bookmarks still work. */}
              <Route path="/" element={<Navigate to="/calendar" replace />} />
              <Route path="/my-leaves" element={titled('routes.myLeaves', <MyLeavesPage />)} />
              <Route path="/my-settings" element={titled('routes.mySettings', <MySettingsPage />)} />
              <Route
                path="/leave-requests/:id"
                element={titled('routes.requestDetails', <RequestContextPage />)}
              />
              <Route
                path="/calendar"
                element={titled('routes.calendar', <TeamCalendarPage />)}
              />
              <Route
                path="/approvals"
                element={titled('routes.approvals', <ApprovalsPage />)}
              />
              <Route
                path="/reports"
                element={titled('routes.reports', <ReportCatalogPage />)}
              />
              <Route
                path="/reports/:reportSlug"
                element={titled('routes.reports', <ReportCenterPage />)}
              />
              <Route
                path="/import"
                element={titled('routes.import', <ImportWizardPage />)}
              />
              <Route
                path="/corrections"
                element={titled('routes.corrections', <CorrectionsPage />)}
              />
              <Route
                path="/settings"
                element={titled('routes.settings', <SettingsPage />)}
              />
              <Route
                path="/settings/leave-policies/:draftPublicId"
                element={titled('routes.policySettings', <PolicySettingsPage />)}
              />
              <Route
                path="/onboarding"
                element={titled('routes.onboarding', <OnboardingPage />)}
              />
              <Route
                path="/settings/billing"
                element={titled('routes.billing', <PlanAndBillingPage />)}
              />
              <Route
                path="*"
                element={titled(
                  'notFound.title',
                  <PagePlaceholder
                    title={t('notFound.title')}
                    subtitle={t('notFound.subtitle')}
                  />,
                )}
              />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}

export function CustomerRouter() {
  const router = useMemo(
    () =>
      createBrowserRouter([
        {
          path: '/login/handoff',
          element: <RegistrationHandoffPage />,
        },
        {
          path: '*',
          element: (
            <AuthProvider>
              <CustomerRoutes />
            </AuthProvider>
          ),
        },
      ]),
    [],
  )
  return <RouterProvider router={router} />
}
