import { adminDb } from '@/lib/db'

/**
 * Lean data for the write-page rails: the author's recent DRAFTS (unpublished
 * posts, for the quick-switch list) and a stats glance (unlock count, summed
 * earnings, follower count). Published articles are intentionally excluded — the
 * rail is labelled "Your drafts", so it lists only what's still unpublished. A
 * few indexed queries — cheap enough to run inline on the server page without
 * Suspense. Never throws; degrades to empties so the editor always renders.
 *
 * @param {{ authorId?: string | null, accountId?: string | null }} args
 * @returns {Promise<{ drafts: Array<{id,title,slug,published,createdAt}>,
 *   stats: { unlocks: number, earnedXec: number, followers: number } }>}
 */
export async function getWriteSidebarData({ authorId = null, accountId = null } = {}) {
  const admin = adminDb()

  const [postsQ, unlocksQ, followersQ] = await Promise.all([
    // Recent DRAFTS (unpublished) for the quick-switch list — published
    // articles are excluded so the list matches its "Your drafts" label.
    authorId
      ? admin
          .from('posts')
          .select('id, title, slug, published, created_at')
          .eq('author_id', authorId)
          .eq('published', false)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    // Unlock count + summed earnings over this author's published posts — same
    // shape as /api/dashboard/stats.
    authorId
      ? admin
          .from('unlocks')
          .select('amount_xec, posts!inner(author_id)')
          .eq('posts.author_id', authorId)
          .eq('posts.published', true)
      : Promise.resolve({ data: [] }),
    // Follower count (head-only, no rows transferred).
    accountId
      ? admin
          .from('feed_follows')
          .select('*', { count: 'exact', head: true })
          .eq('followee_account_id', accountId)
      : Promise.resolve({ count: 0 }),
  ])

  const drafts = (postsQ.data ?? []).map((p) => ({
    id: p.id,
    title: p.title ?? '',
    slug: p.slug ?? '',
    published: p.published === true,
    createdAt: p.created_at ?? null,
  }))

  // NOTE: `unlocks.amount_xec` is misnamed — it stores SATS (the author's
  // received output; see lib/verifyPaymentUnlock.js). Convert to XEC (÷100) so
  // the rail's "Earned … XEC" reads correctly.
  const unlockRows = unlocksQ.data ?? []
  let earnedSats = 0
  for (const r of unlockRows) {
    const s = Number(r.amount_xec)
    if (Number.isFinite(s)) earnedSats += s
  }

  return {
    drafts,
    stats: {
      unlocks: unlockRows.length,
      earnedXec: earnedSats / 100,
      followers: followersQ.count ?? 0,
    },
  }
}
