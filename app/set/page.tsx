import { Suspense } from 'react'
import Link from 'next/link'
import AlarmForm from '@/components/AlarmForm'

export default function SetPage() {
  return (
    <main className="page">
      <div className="page-header">
        <Link href="/" className="back-btn">
          ← Back
        </Link>
        <span className="page-title">Set alarm</span>
        <span style={{ width: 60 }} />
      </div>

      <Suspense fallback={null}>
        <AlarmForm />
      </Suspense>
    </main>
  )
}
