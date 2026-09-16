import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ReportDefinitionKey } from '../../api/client'
import { REPORT_DEFINITIONS, reportSlugFor } from './reportDefinitions'
import './report-catalog.css'

/**
 * A miniature of the shape each report returns, so a report is recognisable before its name
 * is read.
 *
 * Decorative on purpose: `aria-hidden`, and never fed live data. Three of the six reports
 * draw no chart at all today, and their preview shows the table they actually return rather
 * than implying a visualization the product does not have.
 */
function ReportPreview({ definitionKey }: { definitionKey: ReportDefinitionKey }) {
  switch (definitionKey) {
    case 'BALANCE_SNAPSHOT':
      // Rings, matching ReportAnalytics' BalanceRings.
      return (
        <svg viewBox="0 0 280 124" role="presentation">
          <g transform="translate(68,62)">
            <circle r="19" className="rcp-track" strokeWidth="8" />
            <circle
              r="19"
              className="rcp-mint-stroke"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="74 46"
              transform="rotate(-90)"
            />
          </g>
          <g transform="translate(140,62)">
            <circle r="30" className="rcp-track" strokeWidth="12" />
            <circle
              r="30"
              className="rcp-ocean-stroke"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray="122 67"
              transform="rotate(-90)"
            />
          </g>
          <g transform="translate(212,62)">
            <circle r="19" className="rcp-track" strokeWidth="8" />
            <circle
              r="19"
              className="rcp-sun-stroke"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="42 78"
              transform="rotate(-90)"
            />
          </g>
        </svg>
      )
    case 'LEAVE_USAGE':
      // Bars with a trend line, matching ReportAnalytics' UsageTrend.
      return (
        <svg viewBox="0 0 280 124" role="presentation">
          <path d="M30 104h220" className="rcp-axis" />
          {[
            [38, 70, 34],
            [66, 54, 50],
            [94, 78, 26],
            [122, 38, 66],
            [150, 62, 42],
            [178, 48, 56],
            [206, 82, 22],
            [234, 66, 38],
          ].map(([x, y, height]) => (
            <rect key={x} x={x} y={y} width="17" height={height} rx="3" className="rcp-ocean" />
          ))}
          <polyline
            points="46,84 74,74 102,88 130,62 158,76 186,68 214,92 242,80"
            className="rcp-mint-stroke rcp-trend"
          />
        </svg>
      )
    case 'CARRYOVER':
      // Stacked bars, matching ReportAnalytics' CarryoverBars: used / available / expired.
      return (
        <svg viewBox="0 0 280 124" role="presentation">
          {[
            [24, 96, 90, 34],
            [55, 66, 128, 26],
            [86, 138, 56, 0],
          ].map(([y, used, available, expired]) => (
            <g key={y}>
              <rect x="30" y={y} width="220" height="15" rx="7.5" className="rcp-track-fill" />
              <rect x="30" y={y} width={used} height="15" rx="7.5" className="rcp-ocean" />
              <rect x={30 + used} y={y} width={available} height="15" className="rcp-mint" />
              {expired > 0 && (
                <rect
                  x={30 + used + available}
                  y={y}
                  width={expired}
                  height="15"
                  rx="7.5"
                  className="rcp-rose"
                />
              )}
            </g>
          ))}
        </svg>
      )
    case 'PENDING_AGING':
      // Descending buckets: the older the bucket, the smaller and more urgent.
      return (
        <svg viewBox="0 0 280 124" role="presentation">
          <path d="M40 104h210" className="rcp-axis" />
          <rect x="52" y="28" width="42" height="76" rx="4" className="rcp-mint" />
          <rect x="104" y="50" width="42" height="54" rx="4" className="rcp-ocean" />
          <rect x="156" y="70" width="42" height="34" rx="4" className="rcp-sun" />
          <rect x="208" y="86" width="42" height="18" rx="4" className="rcp-rose" />
        </svg>
      )
    case 'EXCEPTION':
      // No chart exists for this report: this is the table it returns, severity dot first.
      return (
        <svg viewBox="0 0 280 124" role="presentation">
          <rect x="30" y="20" width="220" height="18" rx="5" className="rcp-head" />
          <rect x="40" y="26" width="38" height="6" rx="3" className="rcp-muted" />
          <rect x="100" y="26" width="50" height="6" rx="3" className="rcp-muted" />
          {[
            [56, 'rcp-rose', 64, 92],
            [78, 'rcp-sun', 52, 78],
            [100, 'rcp-sun', 58, 86],
          ].map(([cy, tone, w1, w2]) => (
            <g key={cy as number}>
              <circle cx="46" cy={cy as number} r="6" className={tone as string} />
              <rect x="60" y={(cy as number) - 4} width={w1 as number} height="7" rx="3.5" className="rcp-ink" />
              <rect x="140" y={(cy as number) - 4} width={w2 as number} height="7" rx="3.5" className="rcp-line" />
            </g>
          ))}
        </svg>
      )
    case 'REQUEST_DETAIL':
    default:
      // No chart exists for this report either: rows with a status pill, as the table renders.
      return (
        <svg viewBox="0 0 280 124" role="presentation">
          <rect x="30" y="20" width="220" height="18" rx="5" className="rcp-head" />
          <rect x="40" y="26" width="46" height="6" rx="3" className="rcp-muted" />
          <rect x="110" y="26" width="36" height="6" rx="3" className="rcp-muted" />
          <rect x="170" y="26" width="42" height="6" rx="3" className="rcp-muted" />
          {[
            [50, 58, 40, 'rcp-pill-mint'],
            [72, 52, 46, 'rcp-pill-sun'],
            [94, 64, 34, 'rcp-pill-rose'],
          ].map(([y, w1, w2, pill]) => (
            <g key={y as number}>
              <rect x="40" y={y as number} width={w1 as number} height="7" rx="3.5" className="rcp-ink" />
              <rect x="110" y={y as number} width={w2 as number} height="7" rx="3.5" className="rcp-line" />
              <rect
                x="170"
                y={(y as number) - 3}
                width="48"
                height="13"
                rx="6.5"
                className={pill as string}
              />
            </g>
          ))}
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
                  keyboard and screen-reader users two stops for one destination. */}
              <Link
                className="report-catalog-card"
                to={`/reports/${slug}`}
                data-testid={`report-card-${slug}`}
              >
                <span className="report-catalog-preview" aria-hidden="true">
                  <ReportPreview definitionKey={definition.key} />
                </span>
                <span className="report-catalog-name">{t(definition.labelKey)}</span>
                <span className="report-catalog-desc">{t(definition.descriptionKey)}</span>
                <span className="report-catalog-open">{t('reports:catalog.open')}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
