import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, getOnboarding } from '../../api/client'
import { getHomePath, getSafeRedirectPath } from '../../auth/authUtils'
import { useAuth } from '../../auth/useAuth'
import { BuildingIcon, LeaveoLogo } from '../../components/ui/icons'
import { hasSkippedOnboardingRedirect } from '../onboarding/redirectPreference'
import { AuthProofPanel } from './AuthProofPanel'
import './auth-form.css'

/** Sign-in must not block on the onboarding lookup; the dashboard is always a safe landing. */
const ONBOARDING_LOOKUP_TIMEOUT_MS = 3000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error('onboarding lookup timed out')), ms),
    ),
  ])
}

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common'])
  const { login, isAuthenticated, isLoading, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // A Platform Admin has no destination in the customer artifact — every org route is
  // closed to the role, so redirecting one would bounce between here and RoleGuard
  // forever. The API can no longer issue a customer token for an operator at all, so
  // this is a defensive terminal state: show the customer sign-in form rather than
  // loop. Operators sign in at /app-admin/login in the Admin artifact.
  if (!isLoading && isAuthenticated && user && user.role !== 'PLATFORM_ADMIN') {
    const fromPath = getSafeRedirectPath(
      (location.state as { from?: { pathname?: string } } | null)?.from?.pathname,
    )
    const destination = fromPath ?? getHomePath(user.role)
    return <Navigate to={destination} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const signedInUser = await login(email.trim(), password)
      const fromPath = getSafeRedirectPath(
        (location.state as { from?: { pathname?: string } } | null)?.from?.pathname,
      )
      let destination = fromPath ?? getHomePath(signedInUser.role)

      // Resuming is server-owned: an Organization admin who signs back in (including through
      // the assisted password-invitation path) returns to the workflow only while
      // the feature is enabled and required setup is still outstanding.
      // Any unavailable/disabled response preserves the established dashboard cue.
      //
      // The exit condition is onboardingComplete, not Commercial Activation. Activation additionally
      // requires another user to accept an invitation and a full reconciled leave cycle, so gating
      // on it redirected single-admin Organizations to /onboarding on every sign-in forever.
      // A user who chose "Not now" on the guided page keeps their own destination. Without a
      // persisted opt-out, an admin signing in to approve a request was diverted on every login.
      if (
        !fromPath
        && signedInUser.role === 'ORGANIZATION_ADMIN'
        && !hasSkippedOnboardingRedirect(signedInUser.id)
      ) {
        try {
          const onboarding = await withTimeout(getOnboarding(), ONBOARDING_LOOKUP_TIMEOUT_MS)
          if (onboarding.presentationEnabled !== false && onboarding.onboardingComplete !== true) {
            destination = '/onboarding'
          }
        } catch {
          // Existing destination is the intentional safe fallback — including when the lookup
          // times out, so a hung API cannot strand the user on the login form after a
          // successful authentication.
        }
      }

      navigate(destination, { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError(t('auth:errors.tooMany'))
        } else if (err.status === 401) {
          setError(t('auth:errors.invalidCredentials'))
        } else {
          setError(t('auth:errors.signIn'))
        }
      } else {
        setError(t('auth:errors.signIn'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return <div className="auth-loading">{t('auth:loading')}</div>
  }

  return (
    <div className="auth-page" data-testid="login-page">
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="sign-in-title">
          <div className="auth-logo">
            <LeaveoLogo
              layout="stacked"
              label={t('common:brand.name')}
              className="auth-logo-mark"
            />
            <div className="auth-logo-sub">{t('common:brand.tagline')}</div>
          </div>

          <h1 id="sign-in-title" className="auth-form-title">
            {t('auth:login.title')}
          </h1>
          <p className="auth-form-intro">{t('auth:login.intro')}</p>

          {location.state &&
            typeof location.state === 'object' &&
            'passwordReset' in location.state && (
              <div className="auth-success" role="status">
                {t('auth:login.resetSuccess')}
              </div>
            )}

          {location.state &&
            typeof location.state === 'object' &&
            (location.state as { invitationAccepted?: unknown }).invitationAccepted === true && (
              <div className="auth-success" role="status">
                {t('auth:login.invitationAcceptedSuccess')}
              </div>
            )}

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="auth-form-group">
              <label htmlFor="sign-in-email">{t('auth:fields.email')}</label>
              <input
                id="sign-in-email"
                data-testid="sign-in-email"
                className="auth-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="auth-form-group">
              <label htmlFor="sign-in-password">{t('auth:fields.password')}</label>
              <input
                id="sign-in-password"
                data-testid="sign-in-password"
                className="auth-input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              data-testid="sign-in-submit"
              disabled={submitting}
            >
              {submitting ? t('auth:actions.signingIn') : t('auth:actions.signIn')}
            </button>
          </form>

          <Link className="auth-link" to="/forgot-password">
            {t('auth:actions.forgotPassword')}
          </Link>

          <p
            className="auth-tenant-reassurance"
            data-testid="auth-tenant-reassurance"
          >
            <BuildingIcon size={16} aria-hidden="true" />
            <span>{t('auth:login.tenantReassurance')}</span>
          </p>
        </section>

        <AuthProofPanel />
      </main>
    </div>
  )
}
