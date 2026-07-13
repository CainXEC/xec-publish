'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import HandleCardImage from '@/components/HandleCardImage'

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

function QuotedByline({ identity, color }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  if (id.startsWith('@')) {
    return (
      <Link href={`/@${id.slice(1)}`} className="qbyline" style={color ? { '--hc': color } : undefined}>
        {id.slice(1)}
      </Link>
    )
  }
  // A handle-less author still has a profile at /@<address> — link it too.
  return (
    <Link href={`/@${id.replace(/^ecash:/i, '')}`} className="qaddr" title={id}>
      {truncateAddress(id)}
    </Link>
  )
}

// Longer quoted bodies are clamped to a couple of lines inside the embed; the
// full post is one tap away by opening it.
const QUOTE_CLAMP_CHARS = 220

/**
 * A compact, bordered preview of a quoted post, embedded inside a quote post (or
 * the quote composer). Clicking it opens the quoted post's thread. `post` is the
 * shallow preview shape from getFeed (may be a tombstone), or null when the
 * quoted post could not be found.
 */
export default function QuotedEmbed({ post, interactive = true, onOpenThread = null }) {
  const router = useRouter()

  if (post == null) {
    return <div className="quoted quoted-gone">Quoted post unavailable.</div>
  }

  const body = typeof post.content === 'string' ? post.content : ''
  const shown =
    body.length > QUOTE_CLAMP_CHARS ? `${body.slice(0, QUOTE_CLAMP_CHARS).trimEnd()}…` : body

  const go = (e) => {
    if (!interactive) return
    if (e.target.closest('a, button')) return
    // Host pages with a center reading pane open the quoted thread in place.
    if (onOpenThread) {
      onOpenThread(post.txid)
      return
    }
    router.push(`/feed/${post.txid}`)
  }

  return (
    <div
      className="quoted"
      onClick={interactive ? go : undefined}
      role={interactive ? 'link' : undefined}
      tabIndex={interactive ? 0 : undefined}
      style={interactive ? { cursor: 'pointer' } : undefined}
    >
      <div className="qmeta">
        <QuotedByline identity={post.displayIdentity ?? post.author_identity} color={post.displayColor} />
      </div>
      <p className="qbody">
        {post.deleted ? (
          <span className="tombstone">This post was deleted.</span>
        ) : (
          shown
        )}
      </p>
      {/* Quoting a mint announcement is the buyer's "that's me!" moment — the
          card art shows here (and on the thread page) even though timeline
          rows render announcements as compact text. */}
      {!post.deleted && post.card_kind === 'handle_mint' && post.image_url ? (
        <HandleCardImage
          className="qmint-img"
          src={post.image_url}
          handle={typeof post.card_meta?.handle === 'string' ? post.card_meta.handle : null}
          loading="lazy"
        />
      ) : null}
    </div>
  )
}
