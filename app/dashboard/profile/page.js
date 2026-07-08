import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import ProfileSettingsForm from '@/components/dashboard/ProfileSettingsForm'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'

export default async function AuthorProfileSettingsPage() {
  const acct = await getAuthedAccount()
  // Any logged-in wallet can manage its display handle here — including a paid
  // minter who holds a handle but has never written an article (no author row).
  if (!acct) {
    redirect('/login')
  }

  // Reader-only holder (no author row): show just the display-handle picker.
  if (!acct.authorId) {
    return <ProfileSettingsForm hasAuthor={false} initialBio="" initialColor={acct.handleColor ?? ''} />
  }

  const supabase = createSupabaseAdminClient()
  const { data: author, error: authorError } = await supabase
    .from('authors')
    .select('username, bio, xec_address')
    .eq('id', acct.authorId)
    .maybeSingle()

  if (authorError || !author) {
    return (
      <div className="pow-feed">
        <style>{FEED_CSS}</style>
        <FeedTopbar signedIn isAuthor showLogout />
        <main className="wrap" style={{ paddingTop: '28px' }}>
          <section className="dashpanel">
            <div className="error">
              {authorError?.message || 'Author profile not found.'}
            </div>
            <p style={{ marginTop: '16px' }}>
              <Link href="/dashboard" className="dashbtn sec">
                ← Back to dashboard
              </Link>
            </p>
          </section>
        </main>
      </div>
    )
  }

  return (
    <ProfileSettingsForm
      hasAuthor
      initialBio={author.bio != null ? String(author.bio) : ''}
      initialColor={acct.handleColor ?? ''}
    />
  )
}
