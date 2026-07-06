import Link from 'next/link'
import { notFound } from 'next/navigation'
import { resolveProfileByIdentifier } from '@/lib/resolveProfile'
import { hydrateAuthorProfile } from '@/lib/loadAuthorProfile'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { getAuthedAccount } from '@/lib/authHelpers'
import { FEED_CSS } from '@/components/feed/feedTheme'
import ThemeToggle from '@/components/ThemeToggle'

// Reached via the next.config rewrite:  /@<identifier>/articles
// The full list of an author's published articles, in the neon feed theme. A
// read-only server page: every article is just a link to /posts/<slug>.

export async function generateMetadata({ params }) {
  const { identifier: raw } = await params
  const identifier = typeof raw === 'string' ? decodeURIComponent(raw.trim()) : ''
  const resolved = identifier ? await resolveProfileByIdentifier(identifier) : null
  const title = resolved
    ? `Articles by ${resolved.identity} — proofofwriting`
    : 'Articles — proofofwriting'
  return { title, openGraph: { title, type: 'profile' } }
}

function formatXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(8).replace(/\.?0+$/, '')
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function unlockCount(post) {
  const row = Array.isArray(post.unlocks) ? post.unlocks[0] : post.unlocks
  const n = Number(row?.count)
  return Number.isFinite(n) ? n : 0
}

function priceLabel(priceXec) {
  const n = Number(priceXec)
  if (!Number.isFinite(n) || n <= 0) return 'Free'
  return `${formatXec(priceXec)} XEC`
}

function ArticleRow({ post }) {
  const href = post.legacy
    ? `/${encodeURIComponent(post.slug)}`
    : `/posts/${encodeURIComponent(post.slug)}`
  const unlocks = unlockCount(post)
  const readTime = formatReadingTimeLabel(post.reading_time_minutes)
  const date = formatDate(post.published_at ?? post.created_at)

  return (
    <li className="artrow">
      <Link href={href} className="artrow-title">
        {post.title || 'Untitled'}
      </Link>
      <div className="artrow-meta">
        {date ? <span>{date}</span> : null}
        <span className="artrow-sep" aria-hidden>·</span>
        <span>{priceLabel(post.price_xec)}</span>
        <span className="artrow-sep" aria-hidden>·</span>
        <span>🔓 {unlocks.toLocaleString()} {unlocks === 1 ? 'unlock' : 'unlocks'}</span>
        {readTime ? (
          <>
            <span className="artrow-sep" aria-hidden>·</span>
            <span>{readTime}</span>
          </>
        ) : null}
      </div>
      {post.teaser ? <p className="artrow-teaser">{post.teaser}</p> : null}
    </li>
  )
}

export default async function AuthorArticlesPage({ params }) {
  const { identifier: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }
  const identifier = decodeURIComponent(raw.trim())

  const resolved = await resolveProfileByIdentifier(identifier)
  if (!resolved) {
    notFound()
  }

  const viewer = await getAuthedAccount()
  const viewerIsAuthor = viewer?.authorId != null

  const { posts } = resolved.author
    ? await hydrateAuthorProfile(resolved.author)
    : { posts: [] }

  const all = posts ?? []
  const articles = all.filter((p) => !p.legacy)
  const legacy = all.filter((p) => p.legacy)

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>

      <div className="topbar">
        <Link href="/" className="wordmark">
          proofofwriting
        </Link>
        <div className="toplinks">
          {viewerIsAuthor ? (
            <Link href="/dashboard" className="toplink">
              dashboard
            </Link>
          ) : (
            <Link href="/login" className="toplink">
              log in
            </Link>
          )}
          <Link href="/marketplace" className="toplink">
            marketplace
          </Link>
          <ThemeToggle variant="feed" />
        </div>
      </div>

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <Link href={`/@${encodeURIComponent(identifier)}`} className="back">
          ← Back to {resolved.identity}
        </Link>

        <header className="profhead">
          <h1 className="profname">Articles</h1>
          <p className="profbio">
            {articles.length.toLocaleString()} {articles.length === 1 ? 'article' : 'articles'} by{' '}
            {resolved.identity}
          </p>
        </header>

        {articles.length === 0 && legacy.length === 0 ? (
          <p className="empty">No articles published yet.</p>
        ) : (
          <>
            {articles.length > 0 ? (
              <ul className="panel artlist">
                {articles.map((post) => (
                  <ArticleRow key={post.id} post={post} />
                ))}
              </ul>
            ) : null}

            {legacy.length > 0 ? (
              <details className="artlegacy">
                <summary>Legacy posts ({legacy.length})</summary>
                <ul className="panel artlist">
                  {legacy.map((post) => (
                    <ArticleRow key={post.id} post={post} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
