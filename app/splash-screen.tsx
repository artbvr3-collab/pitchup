'use client'

import { useEffect, useState } from 'react'

const SHOW_MS = 2000
const FADE_MS = 450

function Ball() {
  return (
    <svg viewBox="0 0 100 100" width="88" height="88" aria-hidden style={{ filter: 'drop-shadow(0 8px 22px rgba(14,92,47,0.32))' }}>
      <defs>
        <radialGradient id="sp-fill" cx="34%" cy="28%" r="70%">
          <stop offset="0%" stopColor="#e2ff55" />
          <stop offset="50%" stopColor="#c5e63c" />
          <stop offset="100%" stopColor="#176b38" />
        </radialGradient>
        <radialGradient id="sp-shine" cx="28%" cy="22%" r="34%">
          <stop offset="0%" stopColor="white" stopOpacity={0.65} />
          <stop offset="100%" stopColor="white" stopOpacity={0} />
        </radialGradient>
        <clipPath id="sp-clip">
          <circle cx="50" cy="50" r="47" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="47" fill="url(#sp-fill)" />
      <g clipPath="url(#sp-clip)" stroke="#0e5c2f" strokeWidth="1.4" fill="none" opacity={0.2}>
        <path d="M50,3 C64,18 66,32 61,44 C56,58 52,68 50,97" />
        <path d="M50,3 C36,18 34,32 39,44 C44,58 48,68 50,97" />
        <ellipse cx="50" cy="50" rx="46" ry="20" />
      </g>
      <circle cx="50" cy="50" r="47" fill="url(#sp-shine)" />
    </svg>
  )
}

export function SplashScreen() {
  const [phase, setPhase] = useState<'visible' | 'fading' | 'gone'>('visible')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fading'), SHOW_MS)
    const t2 = setTimeout(() => setPhase('gone'), SHOW_MS + FADE_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(120% 80% at 50% 42%, rgba(197,230,60,0.16), transparent 60%), var(--bg-base)',
        opacity: phase === 'fading' ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase !== 'visible' ? 'none' : 'auto',
      }}
    >
      {/* Outer wrapper: Y-axis travel only */}
      <div className="splash-bounce">
        {/* Inner wrapper: squash/stretch only, pinned at bottom edge */}
        <div className="splash-squish">
          <Ball />
        </div>
      </div>

      {/* Ground shadow — stays at ball's resting position */}
      <div
        className="splash-shadow"
        style={{
          width: 56,
          height: 14,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(14,92,47,0.38) 0%, transparent 70%)',
          marginTop: -4,
        }}
      />

      <p
        className="splash-word"
        style={{
          marginTop: 28,
          fontFamily: 'var(--font-sans), system-ui, sans-serif',
          fontWeight: 800,
          fontSize: 18,
          letterSpacing: '0.18em',
          color: 'var(--green-dark)',
          userSelect: 'none',
        }}
      >
        PITCHUP
      </p>
    </div>
  )
}
