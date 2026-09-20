import { redirect } from 'next/navigation'
import { currentSession } from '@/lib/auth/current'

/** The product has no marketing site yet; route straight to where work happens. */
export default async function RootPage() {
  const session = await currentSession().catch(() => null)
  redirect(session ? '/dashboard' : '/sign-in')
}
