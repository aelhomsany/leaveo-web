import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, postResetPassword } from '../../api/client'
import { LeaveoLogo } from '../../components/ui/icons'
import { PasswordInput } from './PasswordInput'
import { PasswordRequirements } from './PasswordRequirements'
import { isPasswordStrong } from './passwordRules'
import './auth-form.css'

export function ResetPasswordPage() {
  const { t } = useTranslation(['auth', 'common'])
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tokenRejected, setTokenRejected] = useState(false)

  const tokenUnusable = !token || tokenRejected
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const requirementsId = 'reset-password-requirements'
  const mismatchId = 'reset-password-confirm-mismatch'
  const submitDescribedBy =
    [requirementsId, passwordsMismatch ? mismatchId : null].filter(Boolean).join(' ') || undefined

  const canSubmit =
    !tokenUnusable &&
    isPasswordStrong(password) &&
    password === confirmPassword &&
    confirmPassword.length > 0 &&
    !submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // The submit button stays disabled until canSubmit is true, and browsers
    // don't implicitly submit a form on Enter when the default button is
    // disabled — so this guard is the only path that can still reach here
    // with an invalid state (e.g. a programmatic form.requestSubmit()).
    if (!canSubmit) {
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      await postResetPassword({ token, password })
      navigate('/login', { replace: true, state: { passwordReset: true } })
    } catch (err) {
      if (err instanceof ApiError) {
        const problemType = err.problem?.type ?? ''
        if (problemType.endsWith('reset-token-invalid')) {
          setPassword('')
          setConfirmPassword('')
          setError(t('auth:errors.invalidReset'))
          setTokenRejected(true)
        } else if (problemType.endsWith('password-too-weak')) {
          setError(t('auth:errors.passwordRequirements'))
        } else {
          setError(t('auth:errors.reset'))
        }
      } else {
        setError(t('auth:errors.reset'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page" data-testid="reset-password-page">
      <div className="auth-card">
        <div className="auth-logo">
          <LeaveoLogo
            layout="stacked"
            label={t('common:brand.name')}
            className="auth-logo-mark"
          />
          <div className="auth-logo-sub">{t('common:brand.tagline')}</div>
        </div>

        <h1 className="auth-form-title">{t('auth:reset.title')}</h1>

        {!token && (
          <div className="auth-error" role="alert">
            {t('auth:errors.invalidReset')}
          </div>
        )}

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <PasswordInput
            id="reset-password"
            label={t('auth:fields.newPassword')}
            testId="reset-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={tokenUnusable}
          />

          <PasswordRequirements id={requirementsId} password={password} />

          <PasswordInput
            id="reset-password-confirm"
            label={t('auth:fields.confirmPassword')}
            testId="reset-password-confirm"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={tokenUnusable}
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
            data-testid="reset-password-submit"
            disabled={!canSubmit}
            aria-describedby={submitDescribedBy}
          >
            {submitting ? t('auth:actions.updating') : t('auth:actions.updatePassword')}
          </button>
        </form>

        <Link className="auth-link" to="/login">
          {t('auth:actions.backToSignIn')}
        </Link>

        {tokenUnusable && (
          <Link className="auth-link auth-link-secondary" to="/forgot-password">
            {t('auth:actions.requestNewReset')}
          </Link>
        )}
      </div>
    </div>
  )
}
