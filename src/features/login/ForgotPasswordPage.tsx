import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError, postForgotPassword } from '../../api/client'
import { LeaveoLogo } from '../../components/ui/icons'
import './auth-form.css'

export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common'])
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (submitted) {
      confirmationHeadingRef.current?.focus()
    }
  }, [submitted])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await postForgotPassword({ email: email.trim() })
      setSubmitted(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t('auth:errors.tooMany'))
      } else {
        setError(t('auth:errors.forgot'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page" data-testid="forgot-password-page">
      <div className="auth-card">
        <div className="auth-logo">
          <LeaveoLogo
            layout="stacked"
            label={t('common:brand.name')}
            className="auth-logo-mark"
          />
          <div className="auth-logo-sub">{t('common:brand.tagline')}</div>
        </div>

        <h1 className="auth-form-title">{t('auth:forgot.title')}</h1>

        {submitted ? (
          <div className="auth-success">
            <h2
              ref={confirmationHeadingRef}
              className="auth-success-heading"
              tabIndex={-1}
            >
              {t('auth:forgot.confirmationTitle')}
            </h2>
            <p className="auth-success-copy">{t('auth:forgot.success')}</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="auth-form-group">
                <label htmlFor="forgot-email">{t('auth:fields.email')}</label>
                <input
                  id="forgot-email"
                  data-testid="forgot-email"
                  className="auth-input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                {submitting ? t('auth:actions.sending') : t('auth:actions.sendReset')}
              </button>
            </form>
          </>
        )}

        <Link className="auth-link" to="/login">
          {t('auth:actions.backToSignIn')}
        </Link>

        <p className="auth-tenant-reassurance">
          {t('auth:forgot.privacyReassurance')}
        </p>
      </div>
    </div>
  )
}
