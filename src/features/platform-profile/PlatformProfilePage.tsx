import { useTranslation } from 'react-i18next'
import '../../i18n/config'
import { usePlatformAuth } from '../platform-auth/usePlatformAuth'
import { isSupportedLocale } from '../../i18n/documentLanguage'
import './platform-profile.css'

/**
 * Read-only operator profile for the Platform Admin artifact.
 *
 * Deliberately not `features/profile/ProfilePage`: that page reads the customer auth context,
 * calls customer-token profile-image endpoints, and renders organization-scoped fields. Operator
 * identity comes from the platform session instead, so this page needs no API call at all.
 */
export function PlatformProfilePage() {
  const { t } = useTranslation(['platformAuth', 'common', 'layout'])
  const { user } = usePlatformAuth()

  if (!user) {
    return null
  }

  return (
    <div className="page page-wide platform-profile-page" data-testid="platform-profile-page">
      <header className="page-header platform-profile-page__header">
        <div>
          <h1 className="page-title">{t('platformAuth:profile.title')}</h1>
          <p className="page-sub">{t('platformAuth:profile.subtitle')}</p>
        </div>
      </header>

      <section className="settings-card platform-profile-card" aria-label={t('platformAuth:profile.summary')}>
        <div className="card-section-header platform-profile-card__header">
          <h2 className="card-title">{t('platformAuth:profile.account')}</h2>
        </div>
        <dl className="platform-profile-list" data-testid="platform-profile-list">
          <div className="platform-profile-row">
            <dt>{t('platformAuth:profile.fields.name')}</dt>
            <dd data-testid="platform-profile-name">{user.fullName}</dd>
          </div>
          <div className="platform-profile-row">
            <dt>{t('platformAuth:fields.email')}</dt>
            <dd data-testid="platform-profile-email">{user.email}</dd>
          </div>
          <div className="platform-profile-row">
            <dt>{t('platformAuth:profile.fields.role')}</dt>
            <dd data-testid="platform-profile-role">{t('common:roles.platformAdmin')}</dd>
          </div>
          <div className="platform-profile-row">
            <dt>{t('platformAuth:profile.fields.preferredLanguage')}</dt>
            <dd data-testid="platform-profile-language">
              {isSupportedLocale(user.preferredLanguage)
                ? t(`layout:language.${user.preferredLanguage}`)
                : t('common:profile.languageNotSet')}
            </dd>
          </div>
        </dl>
        <p className="platform-profile-boundary">{t('platformAuth:profile.boundary')}</p>
      </section>
    </div>
  )
}
