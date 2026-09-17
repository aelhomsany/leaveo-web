import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCwIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/useToast'
import {
  getRecoverablePaidRegistrations,
  recoverPaidRegistration,
  type RecoverablePaidRegistration,
} from '../platform-auth/platformApiClient'
import './organizations-page.css'

export function PaidRegistrationRecoveryPage() {
  const { t } = useTranslation('platform')
  const { showToast } = useToast()
  const [items, setItems] = useState<RecoverablePaidRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)

  useEffect(() => {
    void getRecoverablePaidRegistrations().then(setItems).catch(() => showToast(t('recovery.errors.load'), 'warning')).finally(() => setLoading(false))
  }, [showToast, t])

  async function recover(item: RecoverablePaidRegistration) {
    if (working) return
    setWorking(item.registrationId)
    try {
      await recoverPaidRegistration(item.registrationId)
      setItems((current) => current.filter((value) => value.registrationId !== item.registrationId))
      showToast(t('recovery.success'), 'success')
    } catch {
      showToast(t('recovery.errors.submit'), 'warning')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div
      className="page page-wide organizations-page paid-recovery-page"
      data-testid="platform-paid-recovery-page"
    >
      <header className="page-header organizations-page__header">
        <div>
          <h1 className="page-title">{t('recovery.title')}</h1>
          <p className="page-sub">{t('recovery.subtitle')}</p>
        </div>
      </header>
      {loading ? (
        <section className="organizations-page__empty" aria-live="polite">
          <p className="body-text">{t('recovery.loading')}</p>
        </section>
      ) : items.length === 0 ? (
        <section className="organizations-page__empty"><h2>{t('recovery.empty')}</h2></section>
      ) : (
        <section className="card table-wrap organizations-table-card paid-recovery-table-card" aria-labelledby="paid-recovery-table-title">
          <div className="organizations-table-card__header">
            <h2 id="paid-recovery-table-title">{t('recovery.title')}</h2>
          </div>
          <table className="organizations-table paid-recovery-table">
            <thead><tr><th>{t('recovery.table.organization')}</th><th>{t('recovery.table.plan')}</th><th>{t('recovery.table.status')}</th><th>{t('recovery.table.reference')}</th><th>{t('recovery.table.action')}</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.registrationId}>
              <td><div className="org-cell"><strong className="org-cell__name">{item.organizationName}</strong><bdi className="org-cell__subline">{item.maskedAdministratorEmail}</bdi></div></td>
              <td><span className="plan-badge plan-growth"><bdi>{item.plan}</bdi></span></td><td><span className="recovery-status">{item.status}</span></td><td><bdi className="recovery-reference">{item.registrationId}</bdi></td>
              <td><button type="button" className="btn btn-admin btn-sm organizations-table__action" disabled={working !== null} onClick={() => void recover(item)}><RefreshCwIcon size={14} /> {t('recovery.action')}</button></td>
            </tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  )
}
