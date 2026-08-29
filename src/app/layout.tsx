import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Referral OS',
  description: 'Referral management for specialty practices',
  // PHI containment: referral pages must never be indexed or previewed.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
