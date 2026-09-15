import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { components, ReportQueryResponse } from '../../api/generated/types'
import { PresenceBadge } from '../../components/ui/PresenceBadge'
import { formatDate, formatValue, type ReportFormatContext } from './reportFormat'

type BalanceByLeaveType = components['schemas']['BalanceByLeaveType']
type LeaveUsageDay = components['schemas']['LeaveUsageDay']

type Props = {
  summary: ReportQueryResponse['summary'] | undefined
  incomplete: boolean
  format: ReportFormatContext
}

const RING_RADIUS = 42
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const OFF_SERIES_COUNT = 3

/**
 * Charts for the whole applied view. Every figure shown is one the server sent (AD-4); the only
 * client-side math is geometry — arc length and bar height — which never reaches the page as text.
 */
export function ReportAnalytics({ summary, incomplete, format }: Props) {
  const { t } = useTranslation(['reports'])
  const titleId = useId()
  const bodyId = useId()
  // Phones open with the charts folded away so the results stay within reach.
  const [expanded, setExpanded] = useState(
    () =>
      !(
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 900px)').matches
      ),
  )

  const record = summary as unknown as Record<string, unknown> | undefined
  const balances =
    record?.summaryType === 'BALANCE_SNAPSHOT' && Array.isArray(record.balancesByLeaveType)
      ? (record.balancesByLeaveType as BalanceByLeaveType[])
      : null
  const days =
    record?.summaryType === 'LEAVE_USAGE' && Array.isArray(record.chargedDaysByDate)
      ? (record.chargedDaysByDate as LeaveUsageDay[])
      : null
  if (!balances && !days) return null

  const presenceTotals = record?.chargedDayCountsByPresence as
    | Record<string, number>
    | undefined

  return (
    <section
      className="card reports-analytics"
      aria-labelledby={titleId}
      data-testid="report-analytics"
    >
      <div className="card-header">
        <div>
          <h2 className="card-title" id={titleId}>
            {t('reports:analytics.title')}
          </h2>
          <p className="reports-card-subtitle">
            {balances
              ? t('reports:analytics.balance.description')
              : t('reports:analytics.usage.description')}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t('reports:analytics.hide') : t('reports:analytics.show')}
        </button>
      </div>
      <div
        className="reports-analytics-body"
        id={bodyId}
        hidden={!expanded}
        data-testid="report-analytics-body"
      >
        {incomplete && (
          <p className="reports-analytics-note">{t('reports:analytics.incomplete')}</p>
        )}
        {balances && <BalanceRings balances={balances} format={format} />}
        {days && (
          <UsageTrend
            days={days}
            away={presenceTotals?.OFF ?? 0}
            wfh={presenceTotals?.WFH ?? 0}
            format={format}
          />
        )}
      </div>
    </section>
  )
}

function BalanceRings({
  balances,
  format,
}: {
  balances: BalanceByLeaveType[]
  format: ReportFormatContext
}) {
  const { t, i18n } = useTranslation(['reports'])
  if (balances.length === 0) {
    return <p className="reports-analytics-note">{t('reports:analytics.balance.empty')}</p>
  }

  const percentFormat = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  const seriesClasses = seriesClassesFor(balances)

  return (
    <ul className="reports-rings">
      {balances.map((item, index) => {
        const name = item.leaveTypeName ?? ''
        const percent = item.usedPercent ?? null
        const percentText =
          percent === null
            ? t('reports:analytics.balance.noAllowance')
            : percentFormat.format(percent / 100)
        const arc =
          percent === null ? 0 : (Math.min(Math.max(percent, 0), 100) / 100) * RING_CIRCUMFERENCE
        return (
          <li
            key={item.leaveTypeId}
            className={`reports-ring ${seriesClasses[index]}`}
            data-testid={`report-analytics-ring-${item.leaveTypeId}`}
          >
            <svg
              viewBox="0 0 100 100"
              role="img"
              aria-label={
                percent === null
                  ? t('reports:analytics.balance.ringLabelNoAllowance', { leaveType: name })
                  : t('reports:analytics.balance.ringLabel', {
                      leaveType: name,
                      percent: percentText,
                    })
              }
            >
              <circle className="reports-ring-track" cx="50" cy="50" r={RING_RADIUS} />
              {arc > 0 && (
                <circle
                  className="reports-ring-value"
                  cx="50"
                  cy="50"
                  r={RING_RADIUS}
                  strokeDasharray={`${arc} ${RING_CIRCUMFERENCE}`}
                  transform="rotate(-90 50 50)"
                />
              )}
            </svg>
            <div>
              <p className="reports-ring-name">
                {/* User data is never translated; dir="auto" keeps an LTR name intact in RTL. */}
                <span dir="auto">{name}</span>
                {item.presence === 'WFH' && (
                  <PresenceBadge presence="WFH" label={t('reports:values.WFH')} />
                )}
              </p>
              <p className="reports-ring-percent">{percentText}</p>
              <dl>
                <dt>{t('reports:analytics.balance.used')}</dt>
                <dd>{formatValue(format, item.approvedUsage)}</dd>
                <dt>{t('reports:analytics.balance.allocation')}</dt>
                <dd>{formatValue(format, item.allocation)}</dd>
                <dt>{t('reports:analytics.balance.remaining')}</dt>
                <dd>{formatValue(format, item.remaining)}</dd>
              </dl>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** WFH always takes the mint series; away types cycle through the remaining hues in order. */
function seriesClassesFor(balances: BalanceByLeaveType[]): string[] {
  let offIndex = 0
  return balances.map((item) =>
    item.presence === 'WFH'
      ? 'reports-series-wfh'
      : `reports-series-${offIndex++ % OFF_SERIES_COUNT}`,
  )
}

function UsageTrend({
  days,
  away,
  wfh,
  format,
}: {
  days: LeaveUsageDay[]
  away: number
  wfh: number
  format: ReportFormatContext
}) {
  const { t } = useTranslation(['reports'])
  const peak = days.reduce(
    (highest, day) => Math.max(highest, day.awayDays ?? 0, day.wfhDays ?? 0),
    0,
  )
  if (days.length === 0 || peak === 0) {
    return <p className="reports-analytics-note">{t('reports:analytics.usage.empty')}</p>
  }

  const fromText = formatDate(format, days[0].date ?? '')
  const toText = formatDate(format, days[days.length - 1].date ?? '')
  const height = (value: number | undefined) => ((value ?? 0) / peak) * 100
  const hasWfh = days.some((day) => (day.wfhDays ?? 0) > 0)
  const wfhPoints = days
    .map((day, index) => `${index + 0.5},${100 - height(day.wfhDays)}`)
    .join(' ')

  return (
    <>
      <div className="reports-trend" data-testid="report-analytics-trend">
        <span className="reports-trend-scale">
          <span className="sr-only">{t('reports:analytics.usage.scaleMax')}</span>
          {formatValue(format, peak)}
        </span>
        {/* SVG coordinates ignore direction, so chronology reads left to right like the axis. */}
        <svg
          viewBox={`0 0 ${days.length} 100`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t('reports:analytics.usage.chartLabel', {
            from: fromText,
            to: toText,
            away: formatValue(format, away),
            wfh: formatValue(format, wfh),
          })}
        >
          {days.map((day, index) =>
            (day.awayDays ?? 0) > 0 ? (
              <rect
                key={day.date ?? index}
                className="reports-trend-bar"
                x={index + 0.15}
                width={0.7}
                y={100 - height(day.awayDays)}
                height={height(day.awayDays)}
              />
            ) : null,
          )}
          {hasWfh && (
            <polyline
              className="reports-trend-line"
              points={wfhPoints}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="reports-trend-axis" dir="ltr" aria-hidden="true">
          <span>{fromText}</span>
          <span>{toText}</span>
        </div>
      </div>
      <ul className="reports-legend">
        <li>
          <span className="reports-legend-bar" aria-hidden="true" />
          {t('reports:analytics.usage.away')}
        </li>
        <li>
          <span className="reports-legend-line" aria-hidden="true" />
          {t('reports:analytics.usage.wfh')}
        </li>
      </ul>
    </>
  )
}
