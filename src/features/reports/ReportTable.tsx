import { Fragment, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon } from '../../components/ui/icons'
import { PresenceBadge } from '../../components/ui/PresenceBadge'
import type { ReportDefinition } from './reportDefinitions'
import { formatValue, type ReportFormatContext } from './reportFormat'
import { REPORT_PRIMARY_COLUMNS } from './reportPresentation'

const NUMERIC_COLUMNS = new Set([
  'allocation', 'approvedUsage', 'remaining', 'carryoverAvailable', 'requestCount',
  'chargedDayCount', 'storedDays', 'ageDays', 'carriedDays', 'usedDays',
  'pendingClaimDays', 'expiredDays', 'availableDays',
])

type Props = {
  definition: ReportDefinition
  rows: Array<Record<string, unknown>>
  format: ReportFormatContext
}

export function ReportTable({ definition, rows, format }: Props) {
  const { t } = useTranslation('reports')
  const id = useId()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const primary = REPORT_PRIMARY_COLUMNS[definition.key]
  const columns = primary.flatMap((key) => definition.columns.filter((column) => column.key === key))
  const details = definition.columns.filter((column) => !primary.includes(column.key) && column.key !== 'workforceGroupName')
  const renderValue = (key: string, row: Record<string, unknown>) => {
    const value = row[key]
    if (key === 'userName') {
      const name = formatValue(format, value)
      const initials = typeof value === 'string'
        ? value.trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]).join('')
        : ''
      return (
        <div className="reports-person">
          <span className="reports-person-avatar" aria-hidden="true">{initials}</span>
          <div><span className="reports-person-name" dir="auto">{name}</span>
            <span className="reports-person-group" dir="auto">{formatValue(format, row.workforceGroupName)}</span>
          </div>
        </div>
      )
    }
    if (key === 'presence' && (value === 'WFH' || value === 'OFF')) {
      return <PresenceBadge presence={value} label={formatValue(format, value)} />
    }
    if (key === 'status' || key === 'severity') {
      const tone = ['DECLINED', 'EXPIRED', 'HIGH'].includes(String(value)) ? 'risk'
        : ['PENDING', 'MEDIUM'].includes(String(value)) ? 'pending' : 'neutral'
      return <span className={`reports-status reports-status-${tone}`}>{formatValue(format, value)}</span>
    }
    return formatValue(format, value)
  }

  return (
    <table className="dashboard-table table-compact reports-table">
      <thead><tr>
        {columns.map((column) => <th key={column.key} scope="col" className={NUMERIC_COLUMNS.has(column.key) ? 'reports-number' : undefined}>{t(column.labelKey)}</th>)}
        <th scope="col"><span className="sr-only">{t('results.details')}</span></th>
      </tr></thead>
      <tbody>
        {rows.map((row, index) => {
          const open = expanded.has(index)
          const detailId = `${id}-row-${index}`
          const subject = formatValue(format, row.userName ?? row.subjectLabel ?? row.requestId)
          return (
            <Fragment key={index}>
              <tr data-testid={`report-row-${index}`}>
                {columns.map((column) => (
                  <td key={column.key} dir="auto" className={[
                    typeof row[column.key] === 'number' ? 'reports-number' : '',
                    ['remaining', 'availableDays'].includes(column.key) ? 'reports-remaining' : '',
                    typeof row[column.key] === 'number' && (row[column.key] as number) < 0 ? 'reports-negative' : '',
                  ].filter(Boolean).join(' ')}>{renderValue(column.key, row)}</td>
                ))}
                <td>
                  <button type="button" className="reports-row-toggle" aria-expanded={open} aria-controls={detailId}
                    aria-label={t('results.detailsFor', { name: subject })}
                    onClick={() => setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(index)) next.delete(index)
                      else next.add(index)
                      return next
                    })}>
                    <ChevronDownIcon size={16} />
                  </button>
                </td>
              </tr>
              <tr id={detailId} hidden={!open} className="reports-detail-row">
                <td colSpan={columns.length + 1}>
                  <dl>{details.map((column) => (
                    <div key={column.key}><dt>{t(column.labelKey)}</dt><dd dir="auto">{renderValue(column.key, row)}</dd></div>
                  ))}</dl>
                </td>
              </tr>
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
