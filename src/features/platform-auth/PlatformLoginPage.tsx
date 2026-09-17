import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { BuildingIcon, LeaveoLogo } from '../../components/ui/icons'
import {
  applyDocumentLanguage,
  storePreferredLanguage,
  type SupportedLocale,
} from '../../i18n/documentLanguage'
import i18n from '../../i18n/config'
import { PlatformApiError } from './platformApiClient'
import { usePlatformAuth } from './usePlatformAuth'
import './platform-login.css'

export function PlatformLoginPage() {
  const { t } = useTranslation(['platformAuth', 'common'])
  const { login, isAuthenticated, isLoading } = usePlatformAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = `${t('documentTitle')} | ${t('common:brand.name')}`
  }, [t])

  async function changeLocale(locale: SupportedLocale) {
    await i18n.changeLanguage(locale)
    applyDocumentLanguage(locale)
    storePreferredLanguage(locale)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      navigate('/app-admin/organizations', { replace: true })
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 429) {
        setError(t('errors.tooMany'))
      } else if (caught instanceof PlatformApiError && caught.status === 401) {
        setError(t('errors.invalid'))
      } else {
        setError(t('errors.general'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <main className="platform-login-loading">
        <p>{t('loading')}</p>
      </main>
    )
  }
  if (isAuthenticated) {
    return <Navigate to="/app-admin/organizations" replace />
  }

  return (
    <div className="platform-login-page" data-testid="platform-login-page">
      <main className="platform-login-layout">
        <section className="platform-operator-field" aria-labelledby="platform-realm-title">
          <LeaveoLogo
            tone="reverse"
            width={160}
            label={t('common:brand.name')}
            className="platform-operator-field__brand"
          />
          <p className="platform-operator-field__eyebrow">{t('operatorOnly')}</p>
          <h1 id="platform-realm-title">{t('realm')}</h1>
          <p>{t('boundary')}</p>
          <div className="platform-operator-field__identity">
            <BuildingIcon size={18} aria-hidden="true" />
            <span>{t('brand')}</span>
          </div>
        </section>

        <section className="platform-login-card" aria-label={t('realm')}>
          <div className="platform-login-card__languages" aria-label={t('actions.english')}>
            <button type="button" onClick={() => void changeLocale('en')}>
              {t('actions.english')}
            </button>
            <button type="button" onClick={() => void changeLocale('ar')}>
              {t('actions.arabic')}
            </button>
          </div>
          <p className="platform-login-card__realm">{t('realm')}</p>
          <h2>{t('formTitle')}</h2>
          <p className="platform-login-card__intro">{t('intro')}</p>

          {error ? (
            <div className="auth-error" role="alert">
              {error}
            </div>
          ) : null}

          <form className="platform-login-card__form" onSubmit={submit}>
            <div className="auth-form-group">
              <label htmlFor="platform-sign-in-email">{t('fields.email')}</label>
              <input
                id="platform-sign-in-email"
                data-testid="platform-sign-in-email"
                className="auth-input"
                type="email"
                autoComplete="username"
                dir="ltr"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="auth-form-group">
              <label htmlFor="platform-sign-in-password">{t('fields.password')}</label>
              <input
                id="platform-sign-in-password"
                data-testid="platform-sign-in-password"
                className="auth-input"
                type="password"
                autoComplete="current-password"
                dir="ltr"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button
              className="btn btn-admin platform-login-card__submit"
              type="submit"
              data-testid="platform-sign-in-submit"
              disabled={submitting}
            >
              {submitting ? t('actions.signingIn') : t('actions.signIn')}
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
