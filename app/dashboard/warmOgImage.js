'use server'

import { warmOgImageCache } from '@/lib/articleOgMetadata'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { displayHandlesByAuthorId } from '@/lib/authorDisplayHandles'

/**
 * After a post is published, fetch its OG image URL so the CDN caches it
 * before social crawlers request it.
 */
export async function warmOgImageForPost(postId) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return

  const acct = await getAuthedAccount()
  if (!acct?.authorId) return

  const supabase = adminDb()
  const { data: row, error } = await supabase
    .from('posts')
    .select('title, reading_time_minutes, price_xec, authors(username, is_ai)')
    .eq('id', id)
    .eq('author_id', acct.authorId)
    .maybeSingle()

  if (error || !row) return

  const authorRel = row.authors
  const authorRow = Array.isArray(authorRel) ? authorRel[0] : authorRel
  // Warm the SAME card the article layout renders: byline = the account's live
  // handle only (never the legacy authors.username). Handle-less → no byline.
  const handleMap = await displayHandlesByAuthorId([acct.authorId], supabase)
  const authorHandle = handleMap[acct.authorId]?.handle ?? ''

  await warmOgImageCache({
    title: row.title,
    author: authorHandle,
    readTime: row.reading_time_minutes,
    price: row.price_xec,
    ai: authorRow?.is_ai === true,
  })
}
