import Link from 'next/link'
import type { ReactNode } from 'react'
import { STATUS_LABELS, type ReferralStatus } from '@/lib/domain/referral-status'

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Status is encoded in form as well as text, so a coordinator scanning the
 * inbox reads state without reading words.
 */
const STATUS_TONE: Record<ReferralStatus, string> = {
  NEW: 'bg-brand-soft text-brand',
  UNDER_REVIEW: 'bg-slate-bg text-slate',
  MISSING_INFORMATION: 'bg-amber-bg text-amber',
  WAITING_ON_REFERRING_OFFICE: 'bg-amber-bg text-amber',
  READY_TO_CONTACT: 'bg-brand-soft text-brand',
  PATIENT_CONTACTED: 'bg-slate-bg text-slate',
  READY_TO_SCHEDULE: 'bg-green-bg text-green',
  SCHEDULED: 'bg-green-bg text-green',
  DECLINED: 'bg-red-bg text-red',
  UNABLE_TO_REACH: 'bg-red-bg text-red',
  NOT_ACCEPTED: 'bg-red-bg text-red',
  CLOSED: 'bg-surface-2 text-ink-3',
}

export function StatusBadge({ status }: { status: ReferralStatus }) {
  return (
    <span className={cn(
      'inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium',
      STATUS_TONE[status],
    )}>
      {STATUS_LABELS[status]}
    </span>
  )
}

/** Referral age, coloured by urgency rather than only stated. */
export function AgeChip({ days }: { days: number }) {
  const tone =
    days >= 7 ? 'bg-red-bg text-red' : days >= 3 ? 'bg-amber-bg text-amber' : 'text-ink-3'
  return (
    <span className={cn('tnum inline-flex rounded px-1.5 py-0.5 text-xs', tone)}>
      {days === 0 ? 'today' : `${days}d`}
    </span>
  )
}

export function Card({ title, action, children, className }: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

export function Field({ label, hint, error, children }: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red">{error}</span>}
    </label>
  )
}

export function DataTable({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-rule bg-surface-2 text-left">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">{children}</tbody>
      </table>
    </div>
  )
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="mb-3 flex items-center gap-1.5 text-xs text-ink-3">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-brand hover:underline">{item.label}</Link>
          ) : (
            <span className="text-ink-2">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86_400).toFixed(1)}d`
}
