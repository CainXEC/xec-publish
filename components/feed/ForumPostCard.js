'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import FeedBody from '@/components/feed/FeedBody'
import { REACTIONS } from '@/lib/reactions'
import { isSelectingWithin } from '@/lib/selectionGuard'
import { extractArticleSlug, stripArticleLink } from '@/lib/articleLinks'
import { extractFeedPostTxid, stripFeedPostLink } from '@/lib/contentLinks'
import { extractYouTubeId, stripYouTubeLink } from '@/lib/youtubeLinks'

function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  // Pinned locale + UTC so SSR and client hydrate identical text.
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

// Strip link kinds from the preview text — on the thread page they render as
// their own embed/card, but the card is just a taste, so drop the raw URL.
function previewTextFor(content) {
  let text = extractArticleSlug(content) ? stripArticleLink(content) : content
  text = extractFeedPostTxid(text) ? stripFeedPostLink(text) : text
  text = extractYouTubeId(text) ? stripYouTubeLink(text) : text
  return text
}

function CardByline({ identity, color }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  if (id.startsWith('@')) {
    return (
      <Link href={`/@${id.slice(1)}`} className="byline" style={color ? { '--hc': color } : undefined}>
        {id.slice(1)}
      </Link>
    )
  }
  return (
    <Link href={`/@${id.replace(/^ecash:/i, '')}`} className="addr" title={id}>
      {truncateAddress(id)}
    </Link>
  )
}

/**
 * One post in a forum's index — a Reddit-style DISCUSSION ROW, not a full feed
 * post. The whole card opens the thread page (where the full body + threaded
 * comments + the real react/reply/quote controls live). It leads with the
 * engagement it's inviting: a prominent comment count, plus a read-only reaction
 * summary. All counts are denormalized on the post already (getForumFeedPage), so
 * this renders with no extra fetch.
 */
export default function ForumPostCard({ post }) {
  const router = useRouter()
  const replyCount = post.replyCount ?? 0
  const repostCount = post.repostCount ?? 0
  const reactionCounts = post.reactionCounts ?? {}

  // Reactions with a count, in the palette's display order, capped so the row
  // stays a summary. Read-only here — you react on the thread page.
  const reactionPills = REACTIONS.filter((e) => (reactionCounts[e] ?? 0) > 0)
    .map((e) => ({ emoji: e, count: reactionCounts[e] }))
    .slice(0, 4)

  const open = (e) => {
    // Let the byline link and any real anchor handle their own clicks; and don't
    // hijack a click that's actually the end of a text selection (copying).
    if (e.target.closest('a, button')) return
    if (isSelectingWithin(e.currentTarget)) return
    router.push(`/feed/${post.txid}`)
  }

  const previewText = previewTextFor(post.content ?? '')
  // A video is shown as a compact chip on the card (the full player is on the
  // post's page) so the directory list stays scannable, not a wall of players.
  const hasVideo = extractYouTubeId(post.content ?? '') != null

  return (
    <article
      className="forumcard"
      onClick={open}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(`/feed/${post.txid}`)
      }}
    >
      <div className="forumcard-meta">
        <CardByline identity={post.displayIdentity ?? post.author_identity} color={post.displayColor} />
        <span aria-hidden className="dot">·</span>
        <span className="time" suppressHydrationWarning>{timeAgo(post.created_at)}</span>
      </div>

      {post.title ? <h3 className="forumcard-title">{post.title}</h3> : null}

      {previewText ? (
        <div className={`forumcard-body${post.title ? ' has-title' : ''}`}>
          <FeedBody text={previewText} />
        </div>
      ) : null}

      {hasVideo ? <span className="forumcard-video">▶ Video</span> : null}

      <div className="forumcard-foot">
        <span className="forumcard-comments">
          💬 {replyCount} comment{replyCount === 1 ? '' : 's'}
        </span>
        {reactionPills.length > 0 ? (
          <span className="forumcard-reactions">
            {reactionPills.map(({ emoji, count }) => (
              <span key={emoji} className="forumcard-react">
                <span aria-hidden>{emoji}</span> {count}
              </span>
            ))}
          </span>
        ) : null}
        {repostCount > 0 ? <span className="forumcard-rep">↻ {repostCount}</span> : null}
      </div>
    </article>
  )
}
