import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/current'
import { can } from '@/lib/authz'
import { signOut } from '../login/actions'

/**
 * The authenticated shell.
 *
 * Navigation is filtered by permission, but that is presentation only — every
 * page and every action re-checks server-side. A hidden link is not a control.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.actor.mfaSatisfied) redirect('/mfa')

  const actor = session.actor
  const nav = [
    { href: '/', label: 'Dashboard', show: true },
    { href: '/referrals', label: 'Referrals', show: can(actor, 'referral:read') },
    { href: '/patients', label: 'Patients', show: can(actor, 'patient:read') },
    { href: '/sources', label: 'Referring offices', show: can(actor, 'source:read') },
    { href: '/settings/rules', label: 'Triage rules', show: can(actor, 'config:manage') },
    { href: '/settings/users', label: 'Users', show: can(actor, 'user:manage') },
    { href: '/settings/audit', label: 'Audit', show: can(actor, 'audit:read') },
  ].filter((item) => item.show)

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-2.5">
          <Link href="/" className="text-sm font-semibold text-ink">Referral OS</Link>
          <nav className="flex flex-1 items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2.5 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-xs text-ink-3">
            <span className="hidden sm:inline">{actor.name}</span>
            <form action={signOut}>
              <button type="submit" className="btn-ghost px-2 py-1 text-xs">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>
    </div>
  )
}
