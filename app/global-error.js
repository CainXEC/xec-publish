'use client'

import { useEffect } from 'react'

// Catches errors thrown by the root layout itself (fonts, cookies() read,
// etc.) — a tier below app/error.js, which can't help there since it also
// renders inside the layout. Next requires this to define its own <html>/
// <body> and forbids relying on the layout's stylesheet, hence inline styles.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[app/global-error]', error?.digest ?? '', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center',
          fontFamily: 'monospace',
          background: '#f6f4ed',
          color: '#1a1c17',
        }}
      >
        <p style={{ fontSize: '0.875rem', opacity: 0.6 }}>Something went wrong.</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            border: '1px solid rgba(26,28,23,0.3)',
            borderRadius: '4px',
            padding: '0.5rem 1rem',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        {error?.digest ? (
          <p style={{ fontSize: '0.75rem', opacity: 0.4 }}>ref: {error.digest}</p>
        ) : null}
      </body>
    </html>
  )
}
