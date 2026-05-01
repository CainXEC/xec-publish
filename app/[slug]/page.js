import { cache } from 'react'
import { notFound } from 'next/navigation'
import PostPageClient from '../posts/[slug]/PostPageClient'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAudioStale } from '@/lib/audioConfig'
import { sumAmountRowsByPostId } from '@/lib/supabaseUnlockEarnings'

function countRowsByPostId(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (r?.post_id == null) continue
    const n = typeof r.count === 'number' ? r.count : Number(r.count)
    map[r.post_id] = Number.isFinite(n) ? n : 0
  }
  return map
}

/**
 * Legacy root URLs (`/{slug}`): published posts with `legacy = true` only.
 * Cached per request for generateMetadata + page.
 */
const getLegacyPublishedPostBySlug = cache(async (rawSlug) => {
  const slug =
    typeof rawSlug === 'string' ? decodeURIComponent(rawSlug.trim()) : ''
  if (!slug) return null

  const supabase = createServerSupabase()

  const { data: postRow, error: postError } = await supabase
    .from('posts')
    .select(
      'id, author_id, title, teaser, body, audio_url, audio_char_count, audio_source_hash, price_xec, published, pinned, slug, created_at, published_at, reading_time_minutes, authors ( username, xec_address )',
    )
    .eq('slug', slug)
    .eq('published', true)
    .eq('legacy', true)
    .maybeSingle()

  if (postError || !postRow) return null

  const authorRel = postRow.authors
  const authorRow = Array.isArray(authorRel) ? authorRel[0] : authorRel
  const postIds = [postRow.id]
  const [unlockRes, commentRes, earnedRes] = await Promise.all([
    supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
    supabase.rpc('get_comment_counts', { post_ids: postIds }),
    supabase.rpc('get_unlock_earnings', { post_ids: postIds, since: null }),
  ])

  const earningsById = earnedRes.error ? {} : sumAmountRowsByPostId(earnedRes.data ?? [])

  const post = {
    ...postRow,
    audio_is_stale: isAudioStale(postRow.body, postRow.audio_source_hash),
    earnings: earningsById[postRow.id] ?? 0,
  }
  delete post.authors

  const unlockById = unlockRes.error
    ? {}
    : countRowsByPostId(unlockRes.data ?? [])
  const commentById = commentRes.error
    ? {}
    : countRowsByPostId(commentRes.data ?? [])

  return {
    post,
    author: authorRow ?? null,
    unlockCount: unlockById[post.id] ?? 0,
    commentCount: commentById[post.id] ?? 0,
  }
})

const siteUrl = 'https://www.proofofwriting.com'

/** @param {{ params: Promise<{ slug: string }> }} props */
export async function generateMetadata({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw : ''
  if (!slug) return {}

  const data = await getLegacyPublishedPostBySlug(slug)
  if (!data) return {}

  const { post } = data

  const description = post.teaser?.slice(0, 160)

  return {
    title: `${post.title} | Proof Of Writing`,
    description,
    openGraph: {
      title: post.title,
      description,
      url: `${siteUrl}/${encodeURIComponent(post.slug)}`,
      siteName: 'Proof Of Writing',
      images: [
        {
          url: `${siteUrl}/og-image.png`,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description,
      images: [`${siteUrl}/og-image.png`],
    },
  }
}

export default async function LegacyRootPostPage({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw : ''
  const data = await getLegacyPublishedPostBySlug(slug)
  if (!data) {
    notFound()
  }

  return (
    <PostPageClient
      initialPost={data.post}
      initialAuthor={data.author}
      initialUnlockCount={data.unlockCount}
      initialCommentCount={data.commentCount}
    />
  )
}
