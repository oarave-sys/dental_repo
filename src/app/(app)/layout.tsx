import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { currentSession } from '@/lib/auth/current'
import { TOOLS } from '@/lib/tools/registry'
import { ToolIcon } from '@/components/ui'
import { signOutAction } from '../(auth)/actions'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await currentSession()
  if (!session) redirect('/sign-in')
  const { actor } = session

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-30 border-b border-rule bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-content items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-xs font-semibold text-white">
              DC
            </span>
            <span className="hidden text-[15px] font-semibold tracking-tight text-ink sm:block">
              Dental Coding Assistant
            </span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {TOOLS.filter((t) => t.status === 'AVAILABLE').map((tool) => (
              <Link
                key={tool.key}
                href={tool.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {tool.name}
              </Link>
            ))}
            <Link
              href="/cases"
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              Saved cases
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {actor.isPlatformAdmin && (
              <Link
                href="/admin"
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 sm:block"
              >
                Admin
              </Link>
            )}
            <Link
              href="/settings"
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2"
            >
              Settings
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="btn-ghost btn-sm">
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Mobile tool bar: the three tools stay one tap away at the chair. */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-rule px-3 py-2 md:hidden">
          {TOOLS.filter((t) => t.status === 'AVAILABLE').map((tool) => (
            <Link
              key={tool.key}
              href={tool.href}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-2"
            >
              <ToolIcon name={tool.icon} className="h-4 w-4" />
              {tool.name}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:py-8">{children}</main>

      <footer className="border-t border-rule bg-white px-4 py-5">
        <div className="mx-auto max-w-content">
          <p className="text-[13px] leading-relaxed text-ink-3">
            This tool assists with code selection and documentation review. It does not determine
            or guarantee payer reimbursement, and final coding and billing decisions remain the
            responsibility of the dental practice. Do not enter patient-identifying information.
          </p>
        </div>
      </footer>
    </div>
  )
}
