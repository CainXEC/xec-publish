import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import { heldHandlesForAddress } from '@/lib/heldHandles'
import ProfileSettingsForm from '@/components/dashboard/ProfileSettingsForm'

export default async function ProfileSettingsPage() {
  const acct = await getAuthedAccount()
  if (!acct) {
    redirect('/login')
  }

  const supabase = createSupabaseAdminClient()

  // The display-handle carousel lives on this page. Fetch the held handles + the
  // currently-bound one on the server so it renders with the rest of the page —
  // no client-fetch pop-in.
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

  // Every account is an author identity, so the bio lives on authors.bio for
  // everyone. (During the unify_reader_author migration window an account may
  // briefly still lack an author row; fall back to an empty bio rather than
  // erroring — saving self-heals once the backfill runs.)
  let initialBio = ''
  if (acct.authorId) {
    const { data: author } = await supabase
      .from('authors')
      .select('bio')
      .eq('id', acct.authorId)
      .maybeSingle()
    initialBio = author?.bio != null ? String(author.bio) : ''
  }

  return (
    <ProfileSettingsForm
      initialBio={initialBio}
      initialColor={acct.handleColor ?? ''}
      initialHandles={initialHandles}
      handleAddress={acct.address}
      initialActiveTokenId={initialActiveTokenId}
    />
  )
}
