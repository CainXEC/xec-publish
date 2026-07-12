import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import { ARTICLE_CSS } from '@/app/posts/[slug]/articleTheme'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import { sanitizePostBodyHtml } from '@/lib/sanitizePostBodyHtml'
import { publishDraftPost } from './actions'

function authorFromPost(post) {
  const a = post.authors
  if (!a) return null
  return Array.isArray(a) ? a[0] ?? null : a
}

export default async function DraftPreviewPage({ params, searchParams }) {
  const { id: rawId } = await params
  const id = typeof rawId === 'string' ? rawId.trim() : ''
  if (!id) {
    notFound()
  }

  const sp = (await searchParams) ?? {}
  const paymentBlocked = sp.needsPayment === '1'

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  const supabase = createSupabaseAdminClient()
  const { data: post, error } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, body, created_at, author_id, published, publish_paid, authors(username)',
    )
    .eq('id', id)
    .eq('author_id', acct.authorId)
    .maybeSingle()

  if (error || !post) {
    notFound()
  }

  if (post.published) {
    notFound()
  }

  const author = authorFromPost(post)
  const username = author?.username?.trim()
  // Sanitize even though this is the author's own draft: every other article
  // render path goes through sanitizePostBodyHtml (bodies are stored raw), and a
  // dangerouslySetInnerHTML sink on raw DB HTML is a self-XSS footgun otherwise.
  const bodyHtml = sanitizePostBodyHtml(post.body)

  return (
    <div className="pow-article">
      <style>{ARTICLE_CSS}</style>
      <style>{PREVIEW_CSS}</style>

      {/* Shared feed header — draft preview is author-only, so it carries the
          dashboard link + log out in the hamburger. Hosted in its own .pow-feed
          scope so it matches the homepage header. */}
      <div className="pow-feed topbar-host">
        <style>{FEED_CSS}</style>
        <FeedTopbar signedIn isAuthor showLogout />
      </div>

      <div className="previewbar">
        <span className="previewbar-label">
          <span aria-hidden>●</span> Preview — not yet published
        </span>
        {post.publish_paid === true ? (
          <form action={publishDraftPost}>
            <input type="hidden" name="postId" value={post.id} />
            <button type="submit" className="publishbtn">
              Publish
            </button>
          </form>
        ) : (
          <Link
            href={`/dashboard/edit/${encodeURIComponent(post.id)}`}
            className="publishbtn publishlink"
          >
            Pay &amp; publish in editor
          </Link>
        )}
      </div>

      {post.publish_paid !== true ? (
        <p className="feenote" role={paymentBlocked ? 'alert' : undefined}>
          {paymentBlocked
            ? 'Publishing was blocked: the 100 XEC publish fee has not been paid for this draft. '
            : 'Publishing costs a one-time 100 XEC fee. '}
          Open the draft in the editor to pay and go live.
        </p>
      ) : null}

      <main className="wrap">
        <article className="article">
          <h1 className="arttitle">{post.title}</h1>
          <div className="artbyline">
            <span>By</span>
            {username ? (
              <Link href={`/u/${encodeURIComponent(username)}`} className="bylink">
                {username}
              </Link>
            ) : (
              <span>Unknown author</span>
            )}
          </div>

          {post.teaser ? (
            <section className="section">
              <p className="preview-head">Preview</p>
              <div className="prose">
                <p style={{ whiteSpace: 'pre-wrap' }}>{post.teaser}</p>
              </div>
            </section>
          ) : null}

          <section className="section">
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </section>
        </article>
      </main>
    </div>
  )
}

// Draft-preview banner, layered on ARTICLE_CSS. Amber warning tone for the
// "not yet published" strip; the Publish button reuses the neon action style.
const PREVIEW_CSS = `
.pow-article .previewbar{max-width:760px;margin:18px auto 0;display:flex;flex-wrap:wrap;align-items:center;
  justify-content:space-between;gap:12px;border:1px solid #7a5a12;background:rgba(240,192,75,.08);
  border-radius:12px;padding:12px 16px;}
.pow-article .previewbar-label{display:inline-flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.14em;
  text-transform:uppercase;color:#f0c04b;}
.pow-article .publishbtn{background:transparent;color:var(--neon);border:1px solid var(--neon);border-radius:9px;
  padding:9px 18px;font:inherit;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;
  box-shadow:0 0 16px rgba(0,255,156,.14),inset 0 0 12px rgba(0,255,156,.05);
  transition:background .15s,color .15s,box-shadow .15s;}
.pow-article .publishbtn:hover{background:var(--neon);color:#04120c;box-shadow:0 0 26px rgba(0,255,156,.5);}
.pow-article .publishlink{display:inline-block;text-decoration:none;}
.pow-article .feenote{max-width:760px;margin:10px auto 0;padding:0 16px;font-size:13px;line-height:1.5;color:#f0c04b;}
`
