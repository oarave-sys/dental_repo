import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Dental Coding Assistant',
    template: '%s · Dental Coding Assistant',
  },
  description:
    'Describe the procedure. Identify the likely CDT code, check the documentation, and catch problems before the claim goes out.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b6b62',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
