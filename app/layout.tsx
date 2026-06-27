import type { Metadata } from 'next'
import './globals.css'
import { AlarmProvider } from '@/context/AlarmContext'

export const metadata: Metadata = {
  title: 'WakeForce',
  description: 'The alarm you have to earn.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <AlarmProvider>{children}</AlarmProvider>
      </body>
    </html>
  )
}
