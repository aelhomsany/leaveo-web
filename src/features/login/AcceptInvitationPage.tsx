import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, postAcceptInvitation } from '../../api/client'
import { LeaveoLogo } from '../../components/ui/icons'
import { AuthProofPanel } from './AuthProofPanel'
import { PasswordInput } from './PasswordInput'
import { PasswordRequirements } from './PasswordRequirements'
import { isPasswordStrong } from './passwordRules'
import './auth-form.css'

export function AcceptInvitationPage() {
  const { t } = useTranslation(['auth', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const tokenFromUrl = searchParams.get('token')
  const [token, setToken] = useState(() => tokenFromUrl ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [invitationRejected, setInvitationRejected] = useState(false)
  const submissionInFlight = useRef(false)
  const mounted = useRef(true)

  const effectiveToken = tokenFromUrl ?? token
  const invitationUnusable = effectiveToken.trim().length === 0 || invitationRejected
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const requirementsId = 'accept-invitation-password-requirements'
  const mismatchId = 'accept-invitation-password-mismatch'
  const submitDescribedBy =
    [requirementsId, passwordsMismatch ? mismatchId : null].filter(Boolean).join(' ') || undefined
  const canSubmit =
    !invitationUnusable &&
    isPasswordStrong(password) &&
    password.length <= 128 &&
    password === confirmPassword &&
    confirmPassword.length > 0 &&
    !submitting

  useEffect(() => {
    if (tokenFromUrl == null) {
      return
    }

    if (tokenFromUrl !== token) {
      setToken(tokenFromUrl)
      setPassword('')
      setConfirmPassword('')
      setError(null)
      setInvitationRejected(false)
    }

    const sanitizedParams = new URLSearchParams(searchParams)
    sanitizedParams.delete('token')
    setSearchParams(sanitizedParams, { replace: true })
  }, [searchParams, setSearchParams, token, tokenFromUrl])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || submissionInFlight.current) {
      return
    }

    submissionInFlight.current = true
    setError(null)
    setSubmitting(true)

    try {
      await postAcceptInvitation({ token: effectiveToken, password })
      if (!mounted.current) {
        return
      }
      navigate('/login', { replace: true, state: { invitationAccepted: true } })
    } catch (err) {
      if (!mounted.current) {
        return
      }
      if (err instanceof ApiError) {
        if (err.problem.code === 'plan-limit-reached') {
          setError(t('auth:errors.invitationPlanLimit'))
        } else if (err.status === 409 && err.problem.code == null) {
          setPassword('')
          setConfirmPassword('')
          setError(t('auth:errors.invitationUnusable'))
          setInvitationRejected(true)
        } else if ((err.problem.type ?? '').endsWith('password-too-weak')) {
          setError(t('auth:errors.passwordRequirements'))
        } else {
          setError(t('auth:errors.invitationAccept'))
        }
      } else {
        setError(t('auth:errors.invitationAccept'))
      }
    } finally {
      submissionInFlight.current = false
      if (mounted.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="auth-page" data-testid="accept-invitation-page">
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="accept-invitation-title">
          <div className="auth-logo">
            <LeaveoLogo
              layout="stacked"
              label={t('common:brand.name')}
              className="auth-logo-mark"
            />
            <div className="auth-logo-sub">{t('common:brand.tagline')}</div>
          </div>

          <h1 id="accept-invitation-title" className="auth-form-title">
            {t('auth:invitation.title')}
          </h1>
          <p className="auth-form-intro">{t('auth:invitation.intro')}</p>

          {effectiveToken.trim().length === 0 && (
            <div className="auth-error" role="alert">
              {t('auth:errors.invitationUnusable')}
            </div>
          )}

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <PasswordInput
              id="accept-invitation-password"
              label={t('auth:fields.newPassword')}
              testId="accept-invitation-password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={invitationUnusable}
              aria-describedby={requirementsId}
            />

            <PasswordRequirements id={requirementsId} password={password} />

            <PasswordInput
              id="accept-invitation-password-confirm"
              label={t('auth:fields.confirmPassword')}
              testId="accept-invitation-password-confirm"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={invitationUnusable}
              aria-invalid={passwordsMismatch}
              aria-describedby={passwordsMismatch ? mismatchId : undefined}
            />
            {passwordsMismatch && (
              <p id={mismatchId} className="auth-field-hint" role="status">
                {t('auth:errors.passwordMismatch')}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              data-testid="accept-invitation-submit"
              disabled={!canSubmit}
              aria-describedby={submitDescribedBy}
            >
              {submitting ? t('auth:actions.acceptingInvitation') : t('auth:actions.acceptInvitation')}
            </button>
          </form>

          <Link className="auth-link" to="/login">
            {t('auth:actions.backToSignIn')}
          </Link>
        </section>

        <AuthProofPanel />
      </main>
    </div>
  )
}
