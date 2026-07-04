import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import ProfileSettingsForm from '@/components/dashboard/ProfileSettingsForm'

export default async function AuthorProfileSettingsPage() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  const supabase = createSupabaseAdminClient()
  const { data: author, error: authorError } = await supabase
    .from('authors')
    .select('username, bio, xec_address')
    .eq('id', acct.authorId)
    .maybeSingle()

  if (authorError || !author) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
        <div className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-red-600 dark:text-red-400">
            {authorError?.message || 'Author profile not found.'}
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-200"
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <ProfileSettingsForm
      initialUsername={author.username ?? ''}
      initialBio={author.bio != null ? String(author.bio) : ''}
      initialXecAddress={author.xec_address ?? ''}
    />
  )
}
