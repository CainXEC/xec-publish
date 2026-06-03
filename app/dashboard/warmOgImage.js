'use server'

import { warmOgImageCache } from '@/lib/articleOgMetadata'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * After a post is published, fetch its OG image URL so the CDN caches it
 * before social crawlers request it.
 */
export async function warmOgImageForPost(postId) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return

  const { data: row, error } = await supabase
    .from('posts')
    .select('title, reading_time_minutes, price_xec, authors(username)')
    .eq('id', id)
    .eq('author_id', user.id)
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
