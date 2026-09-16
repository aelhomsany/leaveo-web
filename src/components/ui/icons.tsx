import type { ReactNode, SVGProps } from 'react'

/**
 * Shared UI icon set — 24px-grid stroke icons (Lucide-style, currentColor).
 * Use these for all UI chrome (nav, bell, empty states) instead of emoji,
 * which render inconsistently across platforms. Emoji remain fine inside
 * user/content data (e.g. server-provided leave-type icons). The Leaveo logo
 * lives here too, as brand artwork rather than an icon (see below).
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function IconBase({ size = 18, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

/*
 * Leaveo logo — the "Pause L" symbol and its lockups, with the geometry of the brand kit
 * (Leaveo/output/leaveo-pause-brand/build.py). Brand artwork, not an icon: it keeps the kit's
 * own navy and teal instead of currentColor or app tokens, because the logo palette identifies
 * the brand and must not follow a surface token. Inline SVG, so the prerendered public site and
 * the CSP need nothing extra. Never mirror it in RTL.
 */
const BRAND_NAVY = '#093C5D'
const BRAND_TEAL = '#22A699'
const BRAND_WHITE = '#FFFFFF'

type BrandTone = 'color' | 'reverse'

type BrandProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'width' | 'height'> & {
  /** `color` (navy L) on light surfaces, `reverse` (white L) on navy. The bar stays teal. */
  tone?: BrandTone
  /** Accessible name. Leave it out when nearby text or a labelled link already names Leaveo. */
  label?: string
}

function brandA11y(label: string | undefined) {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
}

function PauseL({ tone }: { tone: BrandTone }) {
  return (
    <>
      <path
        fill={tone === 'reverse' ? BRAND_WHITE : BRAND_NAVY}
        d="M24 8a16 16 0 0 1 16 16v64a8 8 0 0 0 8 8h48a16 16 0 0 1 0 32H40a32 32 0 0 1-32-32V24A16 16 0 0 1 24 8Z"
      />
      <rect fill={BRAND_TEAL} x="64" y="24" width="24" height="56" rx="12" />
    </>
  )
}

const WORDMARK_E = 'M34 34H68C68 8 34 8 34 34C34 57 59 60 68 47'

function Wordmark({ tone }: { tone: BrandTone }) {
  return (
    <g
      fill="none"
      stroke={tone === 'reverse' ? BRAND_WHITE : BRAND_NAVY}
      strokeWidth={8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3V46Q8 54 17 54" />
      <path d={WORDMARK_E} />
      <path d="M115 34C115 8 81 8 81 34C81 60 115 60 115 34V54" />
      <path d="M129 17L145 54L161 17" />
      <path d={WORDMARK_E} transform="translate(141 0)" />
      <ellipse cx="239" cy="35" rx="17" ry="20" />
    </g>
  )
}

/** Leaveo symbol alone, for compact branding at 24px and up. */
export function LeaveoSymbol({
  size = 32,
  tone = 'color',
  label,
  ...props
}: BrandProps & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 136 136" {...brandA11y(label)} {...props}>
      <PauseL tone={tone} />
    </svg>
  )
}

/**
 * Leaveo logo lockup. Horizontal for the sidebar and headers (144–176px wide, never under
 * 132px); stacked for sign-in (140–196px wide). Keep one pause-bar width of clear space.
 */
export function LeaveoLogo({
  layout = 'horizontal',
  width,
  tone = 'color',
  label,
  ...props
}: BrandProps & { layout?: 'horizontal' | 'stacked'; width?: number }) {
  const stacked = layout === 'stacked'
  const [viewWidth, viewHeight] = stacked ? [280, 224] : [440, 136]
  const renderedWidth = width ?? (stacked ? 140 : 144)
  return (
    <svg
      width={renderedWidth}
      height={(renderedWidth * viewHeight) / viewWidth}
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      {...brandA11y(label)}
      {...props}
    >
      {stacked ? (
        <>
          <g transform="translate(72 0)">
            <PauseL tone={tone} />
          </g>
          <g transform="translate(8 155)">
            <Wordmark tone={tone} />
          </g>
        </>
      ) : (
        <>
          <PauseL tone={tone} />
          <g transform="translate(164 35)">
            <Wordmark tone={tone} />
          </g>
        </>
      )}
    </svg>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </IconBase>
  )
}

export function DashboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </IconBase>
  )
}

export function ReportIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </IconBase>
  )
}

export function ClipboardListIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </IconBase>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </IconBase>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </IconBase>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}

export function BuildingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </IconBase>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 6 9 17l-5-5" />
    </IconBase>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </IconBase>
  )
}

export function RefreshCwIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M16 8h5V3" />
    </IconBase>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </IconBase>
  )
}

export function InboxIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </IconBase>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </IconBase>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </IconBase>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconBase>
  )
}

export function UserIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </IconBase>
  )
}

export function LogOutIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </IconBase>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}

export function EyeOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </IconBase>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  )
}

export function AlertDiamondIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.3 2.9 2.9 10.3a2.4 2.4 0 0 0 0 3.4l7.4 7.4a2.4 2.4 0 0 0 3.4 0l7.4-7.4a2.4 2.4 0 0 0 0-3.4l-7.4-7.4a2.4 2.4 0 0 0-3.4 0Z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </IconBase>
  )
}

/** Download — used for the CSV template and source-evidence downloads on the import wizard. */
export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </IconBase>
  )
}

/** Overflow menu ("more actions") — the trigger for a row's secondary actions. */
export function MoreHorizontalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </IconBase>
  )
}

/** Chevron up — reorder-up control on ordered settings lists. */
export function ChevronUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m18 15-6-6-6 6" />
    </IconBase>
  )
}

/** Chevron down — reorder-down control on ordered settings lists. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  )
}

/** Message square — chat channel integrations (Slack / Teams) in Settings. */
export function MessageSquareIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </IconBase>
  )
}
