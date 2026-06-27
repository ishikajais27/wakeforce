'use client'

export default function RingingPulse() {
  return (
    <div className="pulse-backdrop" aria-hidden="true">
      <div className="pulse pulse-1" />
      <div className="pulse pulse-2" />
      <div className="pulse pulse-3" />
    </div>
  )
}
