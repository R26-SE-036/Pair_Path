import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

import PlatformSessionGate from '@/components/PlatformSessionGate'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'PairPath — Collaborative Pair Programming',
  description: 'AI-powered collaborative pair programming platform for learning Java with adaptive support and real-time collaboration',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-surface-950 text-white antialiased`}>
        {/* Catches a session handed over by the Code Guru portal (tokens arrive
            in the URL fragment) and trades it for a PairPath one. */}
        <PlatformSessionGate>{children}</PlatformSessionGate>
      </body>
    </html>
  )
}
