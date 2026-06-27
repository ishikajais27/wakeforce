import Link from 'next/link'
import ClockDisplay from '@/components/ClockDisplay'
import AlarmList from '@/components/AlarmList'

export default function Home() {
  return (
    <main className="page">
      <div className="page-header">
        <span className="page-title">⏰ WakeForce</span>
      </div>
      <ClockDisplay />
      <AlarmList />
      <Link href="/set" className="fab" aria-label="Add alarm">
        +
      </Link>
    </main>
  )
}
