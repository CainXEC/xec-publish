'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-browser'

function formatSupabaseErrorForUser(err) {
  if (!err) return 'Update failed.'
  const bits = [err.message].filter(Boolean)
  if (err.code) bits.push(`[${err.code}]`)
  if (err.details) bits.push(String(err.details))
  if (err.hint) bits.push(`Hint: ${err.hint}`)
  return bits.join(' ')
}

export default function ProfileSettingsForm({
  initialUsername,
  initialBio,
  initialXecAddress,
}) {
  const router = useRouter()
  const [username, setUsername] = useState(initialUsername ?? '')
  const [bio, setBio] = useState(initialBio ?? '')
  const [xecAddress, setXecAddress] = useState(initialXecAddress ?? '')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [savedMessage, setSavedMessage] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setSavedMessage(false)
    setSubmitting(true)

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) {
        console.error('[profile] getUser failed before update', {
          message: userError.message,
          name: userError.name,
        })
        setSubmitError(userError.message)
        return
      }
      const user = userData.user
      if (!user) {
        console.error('[profile] no authenticated user before update')
        router.replace('/login')
        return
      }

      const usernameTrimmed = username.trim()
      const xecTrimmed = xecAddress.trim()
      if (!usernameTrimmed) {
        setSubmitError('Username is required.')
        return
      }
      if (!xecTrimmed) {
        setSubmitError('XEC wallet address is required.')
        return
      }

      console.log('[profile] authors.update', {
        authorRowId: user.id,
        filter: { id: user.id },
      })

      const { data: updated, error: updateError } = await supabase
        .from('authors')
        .update({
          username: usernameTrimmed,
          bio: bio.trim() || null,
          xec_address: xecTrimmed,
        })
        .eq('id', user.id)
        .select('id')
        .maybeSingle()

      if (updateError) {
        console.error('[profile] Supabase authors.update failed', {
          message: updateError.message,
          code: updateError.code,
          details: updateError.details,
          hint: updateError.hint,
          authorId: user.id,
        })
        setSubmitError(formatSupabaseErrorForUser(updateError))
        return
      }

      if (!updated) {
        console.error('[profile] authors.update returned no row (0 matches)', {
          authorId: user.id,
          note:
            'Often caused by RLS denying UPDATE, or missing authors row for this user.',
        })
        setSubmitError(
          'No profile row was updated. Your account is signed in, but the update matched 0 rows. Check that an authors row exists for your user id, and in Supabase that RLS policies allow UPDATE on authors where id = auth.uid().',
        )
        return
      }

      setSavedMessage(true)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-2xl">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
        >
          ← Back to dashboard
        </Link>

        <div className="mt-6 mb-6">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Profile settings</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Update how readers see you on your public author page and where you receive XEC payouts.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex flex-col gap-5">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Public URL: /u/{username.trim() || 'your-username'}
              </p>
            </div>

            <div>
              <label
                htmlFor="bio"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Bio <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={5}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="mt-1 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
                placeholder="Shown on your public author page"
              />
            </div>

            <div>
              <label
                htmlFor="xec_address"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                XEC wallet address
              </label>
              <input
                id="xec_address"
                name="xec_address"
                type="text"
                autoComplete="off"
                required
                value={xecAddress}
                onChange={(e) => setXecAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
            </div>

            {submitError ? (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {submitError}
              </p>
            ) : null}

            {savedMessage ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
                Profile saved.
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
