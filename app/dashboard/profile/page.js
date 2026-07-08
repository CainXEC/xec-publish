import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import { heldHandlesForAddress } from '@/lib/heldHandles'
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

  const supabase = createSupabaseAdminClient()

  // The display-handle carousel lives on this page now (moved off the
  // dashboard). Fetch the held handles + the currently-bound one on the server
  // so it renders with the rest of the page — no client-fetch pop-in.
  const [heldHandles, { data: accountRow }] = await Promise.all([
    heldHandlesForAddress(acct.address),
    supabase
      .from('accounts')
      .select('active_handle_token_id')
      .eq('id', acct.accountId)
      .maybeSingle(),
  ])
  const initialHandles = (heldHandles ?? []).map((h) => ({
    tokenId: h.tokenId,
    handle: h.handle,
    imageUrl: h.imageUrl,
  }))
  const initialActiveTokenId = accountRow?.active_handle_token_id ?? null

  // Reader-only holder (no author row): show just the display-handle picker.
  if (!acct.authorId) {
    return (
      <ProfileSettingsForm
        hasAuthor={false}
        initialBio=""
        initialColor={acct.handleColor ?? ''}
        initialHandles={initialHandles}
        handleAddress={acct.address}
        initialActiveTokenId={initialActiveTokenId}
      />
    )
  }

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
      initialHandles={initialHandles}
      handleAddress={acct.address}
      initialActiveTokenId={initialActiveTokenId}
    />
  )
}
