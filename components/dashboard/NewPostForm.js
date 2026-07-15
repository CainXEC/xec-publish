'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import PublishPaywallModal from '@/components/dashboard/PublishPaywallModal'
import WriteReaderPreview from '@/components/dashboard/WriteReaderPreview'
import WriteContextRail from '@/components/dashboard/WriteContextRail'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import { warmOgImageForPost } from '@/app/dashboard/warmOgImage'
import { savePost } from '@/app/dashboard/savePost'
import { charCounterClassName } from '@/lib/charCounterClassName'
import { generateSlug, isUrlSafeSlug } from '@/lib/generateSlug'
import { countPlainTextCharsFromHtml } from '@/lib/plainTextCharCount'
import {
  POST_BODY_PLAIN_MAX,
  POST_SLUG_MAX,
  POST_TITLE_MAX,
} from '@/lib/postFieldLimits'
import { postBodyHasMeaningfulText } from '@/lib/postBodyHasMeaningfulText'

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  ssr: false,
})

const DEFAULT_NEW_POST_BODY =
  '<p></p><div data-paywall-break="true"></div><p></p>'

/**
 * @param {{
 *   existingPost?: object | null,
 *   sidebar?: { drafts?: Array<object>, stats?: object } | null,
 *   identity?: string,
 *   handleColor?: string | null,
 * }} [props] existingPost = server-loaded post to edit (must include `id`);
 *   sidebar/identity/handleColor feed the desktop write rails.
 */
export default function NewPostForm({
  existingPost = null,
  sidebar = null,
  identity = '',
  handleColor = null,
}) {
  const router = useRouter()
  const bodyLabelId = useId()
  const editingPostId = existingPost?.id ?? null
  const isEditMode = Boolean(editingPostId)
  const autosaveTimerRef = useRef(null)
  const autosaveIdRef = useRef(editingPostId)

  const [title, setTitle] = useState(() =>
    existingPost
      ? String(existingPost.title ?? '').slice(0, POST_TITLE_MAX)
      : '',
  )
  const [slug, setSlug] = useState(() =>
    existingPost
      ? String(existingPost.slug ?? '').slice(0, POST_SLUG_MAX)
      : '',
  )
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(() =>
    existingPost ? Boolean(String(existingPost.slug ?? '').trim()) : false,
  )
  const [body, setBody] = useState(
    () => existingPost?.body ?? DEFAULT_NEW_POST_BODY,
  )
  const [priceXec, setPriceXec] = useState(() =>
    existingPost &&
    existingPost.price_xec != null &&
    existingPost.price_xec !== ''
      ? String(existingPost.price_xec)
      : '100',
  )
  const [published, setPublished] = useState(() =>
    Boolean(existingPost?.published),
  )
  const [publishPaid, setPublishPaid] = useState(() =>
    Boolean(existingPost?.publish_paid),
  )
  const [showPublishPaywall, setShowPublishPaywall] = useState(false)
  const [publishPaywallPostId, setPublishPaywallPostId] = useState(null)
  // Focus mode collapses both desktop rails for distraction-free writing.
  const [focusMode, setFocusMode] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [publishPaymentWaiting, setPublishPaymentWaiting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [autosaveStatus, setAutosaveStatus] = useState(() =>
    editingPostId ? 'Saved' : 'Draft not yet saved',
  )

  const slugFieldError = useMemo(() => {
    const t = slug.trim()
    if (!t) return null
    if (!isUrlSafeSlug(t)) {
      return 'Slug can only contain lowercase letters, numbers, and hyphens (no spaces or special characters).'
    }
    return null
  }, [slug])

  // Every post write goes through the savePost server action, which authorizes
  // via the wallet session and stamps author_id server-side. Returns a result
  // object ({ ok, id, needsPayment, unauthorized, error }); never throws for
  // auth/permission. On unauthorized we bounce to /login.
  const persistDraft = useCallback(
    async ({ forceId = null, nextPublished = false } = {}) => {
      const targetId = forceId ?? autosaveIdRef.current
      const result = await savePost({
        forceId: targetId,
        nextPublished,
        isEditMode,
        published,
        title,
        slug,
        body,
        priceXec,
      })
      if (result?.unauthorized) {
        router.replace('/login')
        return result
      }
      if (result?.ok && result.id) {
        autosaveIdRef.current = result.id
      }
      return result
    },
    [body, isEditMode, priceXec, published, router, slug, title],
  )

  const handlePublishPaymentConfirmed = useCallback(async () => {
    setPublishPaid(true)
    setShowPublishPaywall(false)
    setSubmitting(true)
    try {
      const result = await persistDraft({
        forceId: autosaveIdRef.current,
        nextPublished: true,
      })
      if (!result?.ok) {
        setSubmitError(result?.error || 'Could not publish post.')
        return
      }
      if (result.id) {
        await warmOgImageForPost(result.id)
      }
      router.push('/dashboard')
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save post.'
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
      setPublishPaymentWaiting(false)
    }
  }, [persistDraft, router])

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (submitting) return
    const hasMeaningfulTitle = title.trim().length > 0
    const hasMeaningfulBody = postBodyHasMeaningfulText(body)
    if (!hasMeaningfulTitle && !hasMeaningfulBody) return

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveStatus('Saving...')
      const result = await persistDraft({ nextPublished: false })
      if (result?.ok) {
        const ts = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
        setAutosaveStatus(`Draft saved ${ts}`)
      } else if (!result?.unauthorized) {
        setAutosaveStatus('Save failed')
      }
    }, 3000)

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [title, slug, body, priceXec, persistDraft, submitting])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }

    try {
      const price = Number(priceXec)
      if (Number.isNaN(price) || price < 100) {
        setSubmitError('Minimum price is 100 XEC')
        return
      }
      if (price > 1_000_000) {
        setSubmitError('Maximum price is 1,000,000 XEC')
        return
      }

      if (!postBodyHasMeaningfulText(body)) {
        setSubmitError('Body is required')
        return
      }

      const bodyPlainLen = countPlainTextCharsFromHtml(body)
      if (bodyPlainLen > POST_BODY_PLAIN_MAX) {
        setSubmitError(
          `Body must be at most ${POST_BODY_PLAIN_MAX.toLocaleString('en-US')} characters (plain text).`,
        )
        return
      }

      let finalSlug = slug.trim().slice(0, POST_SLUG_MAX)
      if (!finalSlug || !isUrlSafeSlug(finalSlug)) {
        finalSlug = generateSlug(title.trim()).slice(0, POST_SLUG_MAX)
      }
      setSlug(finalSlug)

      // Draft (or unpublish): published box unchecked.
      if (!published) {
        const result = await persistDraft({
          forceId: autosaveIdRef.current,
          nextPublished: false,
        })
        if (result?.unauthorized) return
        if (!result?.ok) {
          setSubmitError(result?.error || 'Could not save post.')
          return
        }
        router.push('/dashboard')
        router.refresh()
        return
      }

      // Publishing: make sure a draft row exists first.
      if (!autosaveIdRef.current) {
        const draftRes = await persistDraft({ nextPublished: false })
        if (draftRes?.unauthorized) return
        if (!draftRes?.ok) {
          setSubmitError(draftRes?.error || 'Could not save post.')
          return
        }
      }

      const draftId = autosaveIdRef.current
      if (!draftId) {
        setSubmitError('Could not create draft. Please try again.')
        return
      }

      // Attempt to go live — savePost enforces the publish-payment gate.
      const pubResult = await persistDraft({
        forceId: draftId,
        nextPublished: true,
      })
      if (pubResult?.unauthorized) return
      if (pubResult?.needsPayment) {
        setPublishPaywallPostId(draftId)
        setPublishPaymentWaiting(false)
        setShowPublishPaywall(true)
        return
      }
      if (!pubResult?.ok) {
        setSubmitError(pubResult?.error || 'Could not save post.')
        return
      }
      if (pubResult.id) {
        await warmOgImageForPost(pubResult.id)
      }

      router.push('/dashboard')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`pow-feed has-rail write-shell${focusMode ? ' write-focus' : ''}`}>
      <style>{FEED_CSS}</style>
      <style>{FORM_CSS}</style>

      <FeedTopbar signedIn isAuthor showLogout marketplaceMobileOnly />

      <div className="feed-cols">
        <aside className="feed-left">
          <WriteContextRail
            drafts={sidebar?.drafts ?? []}
            stats={sidebar?.stats ?? { unlocks: 0, earnedXec: 0, followers: 0 }}
            body={body}
            currentPostId={editingPostId}
          />
        </aside>

        <main className="wrap" style={{ paddingTop: '28px' }}>
        <section className="dashpanel">
          <div className="pf-head">
            <h1 className="dashwelcome">{isEditMode ? 'Edit article' : 'New article'}</h1>
            <button
              type="button"
              className="pf-focus"
              aria-pressed={focusMode}
              onClick={() => setFocusMode((v) => !v)}
            >
              {focusMode ? 'Exit focus' : 'Focus'}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="pf-form">
            <div className="pf-field">
              <label htmlFor="title" className="pf-label">
                Title
              </label>
              <input
                id="title"
                name="title"
                type="text"
                required
                maxLength={POST_TITLE_MAX}
                value={title}
                onChange={(e) => {
                  const v = e.target.value.slice(0, POST_TITLE_MAX)
                  setTitle(v)
                  if (!slugManuallyEdited) {
                    const trimmed = v.trim()
                    setSlug(trimmed ? generateSlug(trimmed).slice(0, POST_SLUG_MAX) : '')
                  }
                }}
                className="pf-input"
              />
              <p
                className={`pf-count ${charCounterClassName(title.length, POST_TITLE_MAX, 20)}`}
              >
                {title.length}/{POST_TITLE_MAX}
              </p>
            </div>

            <div className="pf-field">
              <label htmlFor="slug" className="pf-label">
                Slug <span className="pf-sub">(URL path, e.g. my-first-post)</span>
              </label>
              <input
                id="slug"
                name="slug"
                type="text"
                maxLength={POST_SLUG_MAX}
                value={slug}
                onChange={(e) => {
                  setSlugManuallyEdited(true)
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/\s+/g, '-')
                      .slice(0, POST_SLUG_MAX),
                  )
                }}
                aria-invalid={slugFieldError ? 'true' : 'false'}
                aria-describedby={slugFieldError ? 'slug-field-error' : undefined}
                className={`pf-input${slugFieldError ? ' err' : ''}`}
              />
              {slugFieldError ? (
                <p id="slug-field-error" className="pf-error" role="alert">
                  {slugFieldError}
                </p>
              ) : null}
            </div>

            <div className="pf-field">
              <span id={bodyLabelId} className="pf-label pf-label-row">
                <span>Body</span>
                <span
                  className={`pf-status${autosaveStatus === 'Save failed' ? ' err' : ''}`}
                >
                  ({autosaveStatus})
                </span>
              </span>
              <RichTextEditor
                key={editingPostId ?? 'new'}
                className="pf-editor"
                content={body}
                onChange={setBody}
                id="post-body"
                ariaLabelledBy={bodyLabelId}
              />
            </div>

            <div className="pf-field">
              <label htmlFor="price_xec" className="pf-label">
                Price in XEC
              </label>
              <input
                id="price_xec"
                name="price_xec"
                type="number"
                required
                min={100}
                max={1_000_000}
                step="any"
                value={priceXec}
                onChange={(e) => setPriceXec(e.target.value)}
                className="pf-input narrow"
              />
              <p className="pf-hint">
                Minimum 100 XEC · Maximum 1,000,000 XEC (6% platform fee)
              </p>
            </div>

            <div className="pf-check">
              <input
                id="published"
                name="published"
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              <label htmlFor="published">
                Publish{' '}
                <span className="pf-sub">(live when checked; draft when unchecked)</span>
              </label>
            </div>

            {submitError ? (
              <p className="pf-error" role="alert">
                {submitError}
              </p>
            ) : null}

            {publishPaymentWaiting ? (
              <div className="pf-waiting">
                <div className="pf-waiting-row">
                  <span aria-hidden className="pf-spinner" />
                  <p className="pf-waiting-title">Waiting for payment...</p>
                </div>
                <p className="pf-waiting-sub">This usually takes a few seconds</p>
              </div>
            ) : (
              <button type="submit" disabled={submitting} className="btn pf-submit">
                {submitting
                  ? 'Saving…'
                  : isEditMode
                    ? 'Save changes'
                    : published
                      ? 'Create post'
                      : 'Save draft'}
              </button>
            )}
          </form>
        </section>
        </main>

        <aside className="feed-rail">
          <WriteReaderPreview
            title={title}
            body={body}
            priceXec={priceXec}
            identity={identity}
            handleColor={handleColor}
          />
        </aside>
      </div>

      <PublishPaywallModal
        isOpen={showPublishPaywall}
        onClose={() => {
          setShowPublishPaywall(false)
          setPublishPaymentWaiting(false)
        }}
        postId={publishPaywallPostId ?? ''}
        onPaymentConfirmed={handlePublishPaymentConfirmed}
        onCashtabOpened={() => setPublishPaymentWaiting(true)}
        onPublishPaymentPollingEnded={() => setPublishPaymentWaiting(false)}
      />
    </div>
  )
}

// Neon form chrome for the post editor. Layers on top of FEED_CSS (topbar, panel,
// .btn, .back, .dashwelcome). The tiptap RichTextEditor keeps its own widget
// styling; we only reframe its border/toolbar so it sits inside the neon panel.
const FORM_CSS = `
.pow-feed .pf-form{margin-top:22px;}
.pow-feed .pf-field{margin-top:22px;}
.pow-feed .pf-field:first-child{margin-top:0;}
.pow-feed .pf-label{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.3);}
.pow-feed .pf-label-row{display:flex;align-items:center;gap:8px;}
.pow-feed .pf-sub{font-size:11px;letter-spacing:0;text-transform:none;color:var(--dim);text-shadow:none;}
.pow-feed .pf-status{font-size:11px;letter-spacing:.06em;text-transform:none;color:var(--dim);text-shadow:none;}
.pow-feed .pf-status.err{color:var(--no);}
.pow-feed .pf-input{margin-top:8px;width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:9px;
  padding:11px 13px;color:var(--text);font:inherit;font-size:14px;outline:none;
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .pf-input:focus{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.15);}
.pow-feed .pf-input.err{border-color:var(--no);}
.pow-feed .pf-input.err:focus{box-shadow:0 0 14px rgba(255,92,108,.2);}
.pow-feed .pf-input.narrow{max-width:220px;}
.pow-feed .pf-count{margin-top:6px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;}
.pow-feed .pf-hint{margin:8px 0 0;font-size:12px;color:var(--dim);}
.pow-feed .pf-error{margin:8px 0 0;font-size:13px;color:var(--no);}
.pow-feed .pf-check{display:flex;align-items:center;gap:10px;margin-top:22px;}
.pow-feed .pf-check input{width:16px;height:16px;accent-color:var(--neon);cursor:pointer;}
.pow-feed .pf-check label{font-size:13px;color:var(--text);}
.pow-feed .pf-submit{margin-top:24px;}
.pow-feed .pf-waiting{margin-top:24px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);
  padding:14px 16px;}
.pow-feed .pf-waiting-row{display:flex;align-items:center;gap:12px;}
.pow-feed .pf-spinner{width:16px;height:16px;flex:none;border-radius:50%;border:2px solid var(--line);
  border-top-color:var(--neon);animation:pf-spin .7s linear infinite;}
@keyframes pf-spin{to{transform:rotate(360deg);}}
.pow-feed .pf-waiting-title{margin:0;font-size:13px;font-weight:700;color:var(--text);}
.pow-feed .pf-waiting-sub{margin:6px 0 0;font-size:12px;color:var(--dim);}
/* reframe the tiptap widget so it reads as part of the neon panel */
.pow-feed .pf-editor{margin-top:8px;}
.pow-feed .pf-editor .rich-text-editor{border-color:var(--line)!important;background:var(--panel2)!important;}
.pow-feed .pf-editor [role="toolbar"]{background:var(--panel)!important;border-color:var(--line)!important;}
@media (prefers-reduced-motion:reduce){.pow-feed .pf-spinner{animation:none!important;}}

/* panel header row: title + focus toggle */
.pow-feed .pf-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.pow-feed .pf-focus{background:transparent;border:1px solid var(--line);color:var(--dim);border-radius:8px;
  padding:5px 12px;font:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;
  transition:border-color .15s,color .15s;}
.pow-feed .pf-focus:hover{border-color:var(--cyan);color:var(--cyan);}
.pow-feed .pf-focus[aria-pressed="true"]{border-color:var(--neon);color:var(--neon);}
/* Focus mode: the writing card EXPANDS to fill the width the two alleys leave,
   and animates both directions. Mechanism — the shell keeps its normal centered
   track cluster; toggling focus collapses the side tracks to 0 and lifts the
   center track's cap, all as px→px transitions so grid-template-columns
   interpolates smoothly (no JS, no layout thrash). The alleys fade as they
   squeeze shut. Scoped to .write-shell so the home feed's identical grid is
   untouched. Only runs at the desktop breakpoints where the alleys exist. */
@media (min-width:1100px){
  .pow-feed.write-shell .feed-cols{
    transition:grid-template-columns .42s cubic-bezier(.4,0,.2,1),gap .42s cubic-bezier(.4,0,.2,1);}
  /* 1100–1399px: two tracks (card · right preview). */
  .pow-feed.write-shell.write-focus .feed-cols{grid-template-columns:minmax(0,1160px) 0px;gap:0;}
  .pow-feed.write-shell .feed-left,
  .pow-feed.write-shell .feed-rail{transition:opacity .3s ease;}
  .pow-feed.write-shell.write-focus .feed-left,
  .pow-feed.write-shell.write-focus .feed-rail{opacity:0;overflow:hidden;pointer-events:none;}
}
@media (min-width:1400px){
  /* 1400px+: three tracks (left context · card · right preview). */
  .pow-feed.write-shell.write-focus .feed-cols{grid-template-columns:0px minmax(0,1160px) 0px;gap:0;}
}
@media (prefers-reduced-motion:reduce){
  .pow-feed.write-shell .feed-cols,
  .pow-feed.write-shell .feed-left,
  .pow-feed.write-shell .feed-rail{transition:none;}
}

/* ---- right rail: live reader preview (WriteReaderPreview) ---- */
.pow-feed .wp{padding-top:28px;display:flex;flex-direction:column;gap:12px;}
.pow-feed .wp-eyebrow{margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);}
.pow-feed .wp-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border:1px solid var(--line);
  border-radius:12px;background:var(--panel);}
.pow-feed .wp-card-tag{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--neon);}
.pow-feed .wp-card-title{font-size:16px;font-weight:700;line-height:1.35;color:var(--text);}
.pow-feed .wp-card-teaser{font-size:13px;line-height:1.5;color:var(--dim);}
.pow-feed .wp-card-meta{margin-top:2px;font-size:12px;color:var(--dim);}
/* the author's handle byline carries its swatch on --hc; no handle inherits the
   meta color. Paper darkens the swatch toward ink (else it stays neon). */
.pow-feed .wp-card-author{color:var(--hc);}
html:not(.dark) .pow-feed .wp-card-author{color:color-mix(in oklab, var(--hc) 58%, #000);}
.pow-feed .wp-card-price{color:var(--cyan);}
.pow-feed .wp-dim{opacity:.7;}
.pow-feed .wp-lock{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:10px;
  border:1px solid var(--line);background:rgba(0,255,156,.07);font-size:12px;line-height:1.45;color:var(--neon);}
.pow-feed .wp-lock-icon{flex:none;}
.pow-feed .wp-lock-warn{background:rgba(255,92,108,.08);color:var(--no);}
.pow-feed .wp-lock-free{background:transparent;color:var(--dim);}
.pow-feed .wp-money{border:1px solid var(--line);border-radius:12px;background:var(--panel2);padding:12px 14px;
  display:flex;flex-direction:column;gap:6px;}
.pow-feed .wp-money-row{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;color:var(--dim);}
.pow-feed .wp-money-row strong{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums;}
.pow-feed .wp-money-proj{margin-top:6px;padding-top:8px;border-top:1px solid var(--line);
  display:flex;flex-direction:column;gap:6px;}
.pow-feed .wp-money-proj strong{color:var(--neon);}
.pow-feed .wp-usd{color:var(--dim);font-weight:400;}

/* ---- left rail: author context (WriteContextRail) ---- */
.pow-feed .wc{padding-top:28px;display:flex;flex-direction:column;gap:16px;}
.pow-feed .wc-eyebrow{margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);}
.pow-feed .wc-drafts{display:flex;flex-direction:column;gap:2px;}
.pow-feed .wc-draft{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:13px;
  color:var(--dim);text-decoration:none;transition:background .12s,color .12s;}
.pow-feed a.wc-draft:hover{background:rgba(0,255,156,.06);color:var(--text);}
.pow-feed .wc-draft.is-current{background:rgba(0,255,156,.08);color:var(--neon);}
.pow-feed .wc-draft-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pow-feed .wc-draft-state{flex:none;font-size:11px;color:var(--dim);}
.pow-feed .wc-empty{color:var(--dim);font-size:12px;}
.pow-feed .wc-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dim);}
.pow-feed .wc-dot-pub{background:var(--neon);}
.pow-feed .wc-dot-draft{background:var(--dim);}
.pow-feed .wc-dot-new{background:var(--cyan);}
.pow-feed .wc-stats{display:flex;flex-direction:column;gap:10px;padding-top:14px;border-top:1px solid var(--line);}
.pow-feed .wc-stat{display:flex;flex-direction:column;gap:2px;}
.pow-feed .wc-stat-label{font-size:11px;color:var(--dim);}
.pow-feed .wc-stat-val{font-size:17px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.pow-feed .wc-stat-unit{font-size:11px;font-weight:400;color:var(--dim);}
.pow-feed .wc-writing{display:flex;justify-content:space-between;padding-top:14px;border-top:1px solid var(--line);
  font-size:11px;color:var(--dim);}
`
