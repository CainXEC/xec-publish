'use server'

import { warmOgImageCache } from '@/lib/articleOgMetadata'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * After a post is published, fetch its OG image URL so the CDN caches it
 * before social crawlers request it.
 */
export async function warmOgImageForPost(postId) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return

  const acct = await getAuthedAccount()
  if (!acct?.authorId) return

  const supabase = createSupabaseAdminClient()
  const { data: row, error } = await supabase
    .from('posts')
    .select('title, reading_time_minutes, price_xec, authors(username)')
    .eq('id', id)
    .eq('author_id', acct.authorId)
    .maybeSingle()

  if (error || !row) return

  const authorRel = row.authors
  const authorRow = Array.isArray(authorRel) ? authorRel[0] : authorRel
  const authorUsername = authorRow?.username?.trim() ?? ''

  await warmOgImageCache({
    title: row.title,
    author: authorUsername,
    readTime: row.reading_time_minutes,
    price: row.price_xec,
  })
}
