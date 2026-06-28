import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AlarmProvider } from '@/context/AlarmContext'

export const metadata: Metadata = {
  title: 'WakeForce',
  description: 'The alarm you have to earn.',
  // Allow "Add to Home Screen" on iOS/Android
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'WakeForce',
  },
}

export const viewport: Viewport = {
  // Lock to portrait, prevent user-zoom (important for alarm UX)
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#15101f',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Preload MediaPipe WASM so it's cached before the ringing page */}
        <link
          rel="preload"
          href="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.wasm"
          as="fetch"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.js"
          as="script"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <AlarmProvider>{children}</AlarmProvider>
      </body>
    </html>
  )
}
