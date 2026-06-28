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
        {/* Preload the MediaPipe WASM bundle in a hidden script so it's
            cached before the user ever reaches the ringing page */}
        <link
          rel="preload"
          href="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.wasm"
          as="fetch"
          crossOrigin="anonymous"
        />
      </body>
    </html>
  )
}
