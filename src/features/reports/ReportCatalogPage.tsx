import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ReportDefinitionKey } from '../../api/client'
import { REPORT_DEFINITIONS, reportSlugFor } from './reportDefinitions'
import './report-catalog.css'

/**
 * The data hue each report is tinted with on the catalog. Four hues across six reports, so two
 * repeat; the order below keeps a repeat off its own row neighbour.
 */
const REPORT_ICON_TONE: Record<ReportDefinitionKey, string> = {
  BALANCE_SNAPSHOT: 'ocean',
  LEAVE_USAGE: 'mint',
  REQUEST_DETAIL: 'ocean',
  EXCEPTION: 'rose',
  PENDING_AGING: 'sun',
  CARRYOVER: 'mint',
}

/**
 * One mark per report, drawn for the 44px tile beside the report's name.
 *
 * Deliberately a glyph rather than a miniature of the report's chart. At tile size a real
 * chart's bars and table rows collapse into texture instead of reading as a shape, and three
 * of the six reports draw no chart at all -- so the old previews were inventing a visual for
 * half the catalog and shrinking one past legibility for the other half.
 *
 * Decorative: the wrapping tile is `aria-hidden`, and none of this is ever fed live data.
 */
function ReportIcon({ definitionKey }: { definitionKey: ReportDefinitionKey }) {
  switch (definitionKey) {
    case 'BALANCE_SNAPSHOT':
      // A part-filled ring: a balance is a proportion of an entitlement.
      return (
        <svg viewBox="0 0 24 24" role="presentation">
          <circle cx="12" cy="12" r="8" opacity="0.28" />
          <path d="M12 4a8 8 0 0 1 7.2 11.5" />
        </svg>
      )
    case 'LEAVE_USAGE':
      // Rising bars on a baseline: usage measured over a range.
      return (
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M4 20h16" />
          <path d="M7.5 20v-5M12 20v-9M16.5 20v-6.5" />
        </svg>
      )
    case 'REQUEST_DETAIL':
      // Ruled rows: this report returns records, not a figure.
      return (
        <svg viewBox="0 0 24 24" role="presentation">
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
          <path d="M8 9.5h8M8 13h8M8 16.5h4.5" />
        </svg>
      )
    case 'EXCEPTION':
      // An alert mark: anomalies the reporting service flagged.
      return (
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M12 4.5 21 19.5H3z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r="0.6" className="rci-dot" />
        </svg>
      )
    case 'PENDING_AGING':
      // A clock: this report is about how long something has waited.
      return (
        <svg viewBox="0 0 24 24" role="presentation">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      )
    case 'CARRYOVER':
    default:
      // An arrow turning forward: days moving from one balance year into the next.
      return (
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M4 8.5h11a4.5 4.5 0 0 1 0 9H9" />
          <path d="m7.5 5 3.5 3.5L7.5 12" />
        </svg>
      )
  }
}

/**
 * The Reports landing screen: every fixed report as its own card, replacing the definition
 * dropdown that used to sit inside the workspace. Choosing a report is a navigation to
 * /reports/<slug>, so a report can be linked, bookmarked and reloaded -- none of which the
 * single-route workspace allowed.
 *
 * Deliberately flat rather than grouped: with six reports, headings cost more vertical space
 * than the scanning they save.
 */
export function ReportCatalogPage() {
  const { t } = useTranslation(['reports', 'common'])

  return (
    <div className="page page-wide report-catalog-page" data-testid="report-catalog-page">
      <header className="page-header">
        <div>
          <p className="panel-eyebrow">{t('reports:catalog.eyebrow')}</p>
          <h1 className="page-title">{t('reports:catalog.title')}</h1>
          <p className="page-sub">{t('reports:catalog.subtitle')}</p>
        </div>
      </header>

      <ul className="report-catalog-grid">
        {REPORT_DEFINITIONS.map((definition) => {
          const slug = reportSlugFor(definition.key)
          return (
            <li key={definition.key}>
              {/* The whole card is one link: a card with a separate "open" control gives
                  keyboard and screen-reader users two stops for one destination. That is also
                  why no "view report" text is rendered -- the card's name and sentence are
                  the link's accessible name, and a third line only repeated the destination. */}
              <Link
                className="report-catalog-card"
                to={`/reports/${slug}`}
                data-testid={`report-card-${slug}`}
              >
                <span
                  className={`report-catalog-icon tone-${REPORT_ICON_TONE[definition.key]}`}
                  aria-hidden="true"
                >
                  <ReportIcon definitionKey={definition.key} />
                </span>
                <span className="report-catalog-text">
                  <span className="report-catalog-name">{t(definition.labelKey)}</span>
                  <span className="report-catalog-desc">{t(definition.descriptionKey)}</span>
                </span>
                <svg
                  className="report-catalog-chevron"
                  viewBox="0 0 24 24"
                  role="presentation"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
