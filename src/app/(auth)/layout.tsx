import Link from 'next/link'
import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-paper">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:py-16">
        <Link href="/" className="mb-8 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-white">
            DC
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Dental Coding Assistant
          </span>
        </Link>
        {children}
      </div>
      <footer className="border-t border-rule bg-white px-4 py-4">
        <p className="mx-auto max-w-md text-[13px] leading-relaxed text-ink-3">
          This tool assists with code selection. Final coding and billing decisions remain the
          responsibility of the dental practice.
        </p>
      </footer>
    </main>
  )
}
