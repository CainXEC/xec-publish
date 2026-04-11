'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-browser'

export default function AuthConfirmedPage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        await supabase.auth.signOut()
      } catch {
        /* still send user to login */
      }
      if (!cancelled) {
        router.replace('/login?confirmed=true')
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Confirming your email...</p>
    </div>
  )
}
