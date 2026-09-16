import { useTranslation } from 'react-i18next'
import { PresenceBadge } from '../../components/ui/PresenceBadge'
import type { ReportDefinition, ReportSummaryField } from './reportDefinitions'
import { formatValue, summaryBreakdown, type ReportFormatContext } from './reportFormat'
import { REPORT_PRIMARY_SUMMARIES } from './reportPresentation'

type Props = {
  definition: ReportDefinition
  summary: Record<string, unknown>
  format: ReportFormatContext
}

export function ReportSummary({ definition, summary, format }: Props) {
  const { t } = useTranslation('reports')
  const primaryKeys = REPORT_PRIMARY_SUMMARIES[definition.key]
  const primary = primaryKeys.flatMap((key) => definition.summaryFields.filter((field) => field.key === key))
  const supporting = definition.summaryFields.filter((field) => !primaryKeys.includes(field.key))
  const renderField = (field: ReportSummaryField) => {
    const breakdown = summaryBreakdown(format, summary[field.key])
    return (
      <div
        key={field.key}
        data-testid={`report-summary-${field.key}`}
        className={breakdown ? 'reports-summary-composite' : undefined}
      >
        <dt>{t(field.labelKey)}</dt>
        {breakdown ? (
          <dd className="reports-summary-breakdown">
            <ul>
              {breakdown.map((row) => (
                <li key={row.key}>
                  <span className="reports-breakdown-label">
                    {row.presence ? <PresenceBadge presence={row.presence} label={row.label} /> : row.label}
                  </span>
                  <span className="reports-breakdown-parts">
                    {row.parts.map((part) => (
                      <span key={part.key || row.key} className="reports-breakdown-part">
                        {part.label && <span className="reports-breakdown-part-label">{part.label}</span>}
                        <span className="reports-breakdown-part-value">{part.value}</span>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        ) : <dd>{formatValue(format, summary[field.key])}</dd>}
      </div>
    )
  }

  return (
    <section className="reports-summary" aria-labelledby="report-summary-title">
      <h2 className="sr-only" id="report-summary-title">{t('summary.title')}</h2>
      <dl className="reports-summary-primary">{primary.map(renderField)}</dl>
      <dl className="reports-summary-supporting">{supporting.map(renderField)}</dl>
    </section>
  )
}
