import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { getForumBySlug } from '@/lib/forums'

export const runtime = 'nodejs'

/**
 * DELETE /api/forums/<slug> — the runner removes their own forum, but ONLY while
 * it's empty. Two reasons the empty check is a hard gate, not a nicety:
 *  1. feed_posts.forum_id is ON DELETE SET NULL — deleting a forum with posts
 *     would null their forum_id and LEAK them into the global Feed (breaking
 *     containment). So a non-empty forum must never be deletable.
 *  2. We count LIVE rows (any row with this forum_id, soft-deleted included) so a
 *     stale denormalized post_count can't let a forum that ever held posts through.
 */
export async function DELETE(_req, { params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw.trim() : ''
  if (!slug) return NextResponse.json({ ok: false, error: 'Missing forum.' }, { status: 400 })

  const acct = await getAuthedAccount()
  if (!acct) return NextResponse.json({ ok: false, error: 'Log in first.' }, { status: 401 })

  const supabase = adminDb()
  const forum = await getForumBySlug(supabase, slug)
  if (!forum) return NextResponse.json({ ok: false, error: 'Forum not found.' }, { status: 404 })

  if (forum.runner_account_id !== acct.accountId) {
    return NextResponse.json({ ok: false, error: 'Only the forum runner can delete it.' }, { status: 403 })
  }

  const { count, error: countErr } = await supabase
    .from('feed_posts')
    .select('id', { count: 'exact', head: true })
    .eq('forum_id', forum.id)
  if (countErr) {
    return NextResponse.json({ ok: false, error: 'Could not verify the forum is empty.' }, { status: 500 })
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { ok: false, error: 'A forum can only be deleted while it has no posts.' },
      { status: 409 },
    )
  }

  // Re-check the runner in the delete itself so a concurrent runner change can't
  // slip a delete through.
  const { error: delErr } = await supabase
    .from('forums')
    .delete()
    .eq('id', forum.id)
    .eq('runner_account_id', acct.accountId)
  if (delErr) {
    return NextResponse.json({ ok: false, error: 'Delete failed. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
