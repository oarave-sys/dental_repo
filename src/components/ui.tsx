import Link from 'next/link'
import type { ReactNode } from 'react'

/** Shared presentational primitives. Server components unless marked otherwise. */

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`card ${className}`}>{children}</div>
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{children}</h2>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-rule bg-white/60 px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'

const CONFIDENCE_STYLE: Record<ConfidenceLevel, string> = {
  HIGH: 'border-high-border bg-high-bg text-high',
  MEDIUM: 'border-medium-border bg-medium-bg text-medium',
  LOW: 'border-low-border bg-low-bg text-low',
}

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
}

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return (
    <span className={`chip ${CONFIDENCE_STYLE[level]}`}>
      <span aria-hidden className="text-[10px]">
        {level === 'HIGH' ? '●●●' : level === 'MEDIUM' ? '●●○' : '●○○'}
      </span>
      {CONFIDENCE_LABEL[level]}
    </span>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'high' | 'medium' | 'low' | 'info'
}) {
  const tones: Record<string, string> = {
    neutral: 'border-rule bg-surface-2 text-ink-2',
    brand: 'border-brand/20 bg-brand-soft text-brand',
    high: 'border-high-border bg-high-bg text-high',
    medium: 'border-medium-border bg-medium-bg text-medium',
    low: 'border-low-border bg-low-bg text-low',
    info: 'border-info-border bg-info-bg text-info',
  }
  return <span className={`chip ${tones[tone]}`}>{children}</span>
}

/**
 * The standing disclaimer.
 *
 * Present on every screen that produces a recommendation. It is a product
 * requirement, not a footer: the practice remains responsible for what goes on
 * the claim, and the tool never implies otherwise.
 */
export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[13px] leading-relaxed text-ink-3 ${className}`}>
      Based on the information provided. Code selection, documentation and billing decisions
      remain the responsibility of the dental practice. This tool does not determine or
      guarantee payer reimbursement.
    </p>
  )
}

/**
 * The privacy notice shown above every clinical input.
 *
 * The MVP is explicitly not configured for PHI, and users are told so at the
 * point where they would otherwise paste it.
 */
export function NoPhiNotice() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-medium-border bg-medium-bg px-3.5 py-3">
      <span aria-hidden className="mt-px text-medium">
        &#9888;
      </span>
      <p className="text-[13px] leading-relaxed text-medium">
        <span className="font-semibold">Do not enter patient-identifying information.</span>{' '}
        Describe the procedure only — no names, dates of birth, member IDs or chart numbers.
      </p>
    </div>
  )
}

export function DatasetNotice({
  dataset,
}: {
  dataset: { kind: 'DEMO' | 'LICENSED'; name: string }
}) {
  if (dataset.kind === 'LICENSED') return null
  return (
    <div className="rounded-lg border border-info-border bg-info-bg px-3.5 py-3">
      <p className="text-[13px] leading-relaxed text-info">
        <span className="font-semibold">Sample data.</span> Codes shown come from a
        non-production demo dataset with independently written descriptions. Replace it with a
        licensed CDT dataset before using this for real claims.
      </p>
    </div>
  )
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-1.5 text-sm text-low">
      {message}
    </p>
  )
}

export function FormBanner({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info'
  children: ReactNode
}) {
  const styles = {
    error: 'border-low-border bg-low-bg text-low',
    success: 'border-high-border bg-high-bg text-high',
    info: 'border-info-border bg-info-bg text-info',
  }
  return (
    <div role="alert" className={`rounded-lg border px-3.5 py-3 text-sm ${styles[tone]}`}>
      {children}
    </div>
  )
}

export function ToolIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    check: (
      <>
        <path d="M20 6 9 17l-5-5" />
      </>
    ),
    document: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name] ?? paths.search}
    </svg>
  )
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm text-brand hover:underline">
      &larr; {children}
    </Link>
  )
}
