'use client'

import { useEffect, useRef, useState } from 'react'

export default function CopyableAddress({ address }) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  async function handleCopy() {
    if (!address) return

    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        setCopied(false)
      }, 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-4">
      <p
        className="cursor-pointer break-all text-sm text-zinc-700 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        onClick={handleCopy}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleCopy()
          }
        }}
        title="Click to copy address"
      >
        {address}
      </p>
      {copied ? (
        <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Copied!
        </p>
      ) : null}
    </div>
  )
}
