'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import PublishPaywallModal from '@/components/dashboard/PublishPaywallModal'
import { warmOgImageForPost } from '@/app/dashboard/warmOgImage'
import { supabase } from '@/lib/supabase-browser'
import { calculateReadingTimeMinutes } from '@/lib/calculateReadingTimeMinutes'
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
const PAYWALL_MARKER = '<div data-paywall-break="true"></div>'

function extractTeaserFromBody(html) {
  const src = String(html ?? '')
  const markerIdx = src.indexOf(PAYWALL_MARKER)
  const preview = markerIdx === -1 ? src : src.slice(0, markerIdx)
  const plain = preview
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, 300)
}

/** @param {{ existingPost?: object | null }} [props] Optional server-loaded post to edit (must include `id`). */
export default function NewPostForm({ existingPost = null }) {
  const router = useRouter()
  const bodyLabelId = useId()
  const editingPostId = existingPost?.id ?? null
  const isEditMode = Boolean(editingPostId)
  const autosaveTimerRef = useRef(null)
  const autosaveIdRef = useRef(editingPostId)
  const userIdRef = useRef(null)

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

  const getCurrentUserId = useCallback(async () => {
    if (userIdRef.current) return userIdRef.current
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError) {
      throw new Error(userError.message)
    }
    const userId = userData?.user?.id
    if (!userId) {
      throw new Error('No authenticated user')
    }
    userIdRef.current = userId
    return userId
  }, [])

  const persistDraft = useCallback(async ({
    forceId = null,
    nextPublished = false,
  } = {}) => {
    const userId = await getCurrentUserId()
    let finalSlug = slug.trim().slice(0, POST_SLUG_MAX)
    if (!finalSlug || !isUrlSafeSlug(finalSlug)) {
      finalSlug = generateSlug(title.trim()).slice(0, POST_SLUG_MAX)
    }

    const price = Number(priceXec)
    const safePrice = Number.isFinite(price) ? price : 100
    const bodyTrimmed = body.trim()
    const targetId = forceId ?? autosaveIdRef.current
    // New drafts: autosave keeps published false until explicit publish. Edits: preserve checkbox.
    const publishedForPayload = nextPublished ? true : isEditMode ? published : false
    const payload = {
      author_id: userId,
      title: title.trim(),
      slug: finalSlug,
      teaser: extractTeaserFromBody(bodyTrimmed),
      body: bodyTrimmed,
      reading_time_minutes: calculateReadingTimeMinutes(bodyTrimmed),
      price_xec: safePrice,
      published: publishedForPayload,
    }

    if (nextPublished) {
      if (targetId) {
        const { data: existing } = await supabase
          .from('posts')
          .select('published_at')
          .eq('id', targetId)
          .maybeSingle()
        if (!existing?.published_at) {
          payload.published_at = new Date().toISOString()
        }
      } else {
        payload.published_at = new Date().toISOString()
      }
    }

    if (targetId) {
      const { data: updatedRow, error: upsertError } = await supabase
        .from('posts')
        .upsert({ ...payload, id: targetId })
        .select('id')
        .single()
      if (upsertError) throw upsertError
      if (updatedRow?.id) autosaveIdRef.current = updatedRow.id
      return { id: updatedRow?.id ?? targetId, finalSlug }
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('posts')
      .insert(payload)
      .select('id')
      .single()
    if (insertError) throw insertError
    if (insertedRow?.id) autosaveIdRef.current = insertedRow.id
    return { id: insertedRow?.id ?? null, finalSlug }
  }, [body, getCurrentUserId, isEditMode, priceXec, published, slug, title])

  const handlePublishPaymentConfirmed = useCallback(async () => {
    setPublishPaid(true)
    setShowPublishPaywall(false)
    setSubmitting(true)
    try {
      const { id: publishedId } = await persistDraft({
        forceId: autosaveIdRef.current,
        nextPublished: true,
      })
      if (publishedId) {
        await warmOgImageForPost(publishedId)
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
      try {
        await persistDraft({ nextPublished: false })
        const ts = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
        setAutosaveStatus(`Draft saved ${ts}`)
      } catch {
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
      try {
        await getCurrentUserId()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'No authenticated user'
        setSubmitError(msg)
        if (msg === 'No authenticated user') {
          router.replace('/login')
        }
        return
      }

      if (!userIdRef.current) {
        router.replace('/login')
        return
      }

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

      if (!published) {
        try {
          await persistDraft({
            forceId: autosaveIdRef.current,
            nextPublished: false,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Could not save post.'
          setSubmitError(msg)
          return
        }

        router.push('/dashboard')
        router.refresh()
        return
      }

      if (!autosaveIdRef.current) {
        try {
          await persistDraft({ nextPublished: false })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Could not save post.'
          setSubmitError(msg)
          return
        }
      }

      const draftId = autosaveIdRef.current
      if (!draftId) {
        setSubmitError('Could not create draft. Please try again.')
        return
      }

      const { data: paidRow, error: paidError } = await supabase
        .from('posts')
        .select('publish_paid')
        .eq('id', draftId)
        .maybeSingle()

      if (paidError) {
        setSubmitError(paidError.message)
        return
      }

      const okToPublish = paidRow?.publish_paid === true || publishPaid

      if (!okToPublish) {
        setPublishPaywallPostId(draftId)
        setPublishPaymentWaiting(false)
        setShowPublishPaywall(true)
        return
      }

      try {
        const { id: publishedId } = await persistDraft({
          forceId: autosaveIdRef.current,
          nextPublished: true,
        })
        if (publishedId) {
          await warmOgImageForPost(publishedId)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not save post.'
        setSubmitError(msg)
        return
      }

      router.push('/dashboard')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-5xl">
        <form onSubmit={handleSubmit} className="w-full py-6">
          <div className="mx-auto w-full sm:max-w-2xl">
            <div className="flex flex-col gap-5">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
              <p
                className={`mt-1 text-right text-xs tabular-nums ${charCounterClassName(title.length, POST_TITLE_MAX, 20)}`}
              >
                {title.length}/{POST_TITLE_MAX}
              </p>
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Slug <span className="font-normal text-zinc-500">(URL path, e.g. my-first-post)</span>
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
                className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:ring-2 dark:bg-zinc-950 dark:text-zinc-50 ${
                  slugFieldError
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-400 dark:border-red-500 dark:focus:ring-red-500'
                    : 'border-zinc-300 focus:border-zinc-400 focus:ring-zinc-400 dark:border-zinc-600 dark:focus:ring-zinc-500'
                }`}
              />
              {slugFieldError ? (
                <p id="slug-field-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
                  {slugFieldError}
                </p>
              ) : null}
            </div>

            <div>
              <span
                id={bodyLabelId}
                className="flex flex-row items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                <span>Body</span>
                <span
                  className={`font-normal ${
                    autosaveStatus === 'Save failed'
                      ? 'text-red-500'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  ({autosaveStatus})
                </span>
              </span>
              <RichTextEditor
                key={editingPostId ?? 'new'}
                className="mt-1"
                content={body}
                onChange={setBody}
                id="post-body"
                ariaLabelledBy={bodyLabelId}
              />
            </div>

            <div>
              <label htmlFor="price_xec" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                className="mt-1 w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Minimum 100 XEC · Maximum 1,000,000 XEC (6% platform fee)
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="published"
                name="published"
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950"
              />
              <label htmlFor="published" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Published{' '}
                <span className="font-normal text-zinc-500">(live when checked; draft when unchecked)</span>
              </label>
            </div>

            {submitError ? (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {submitError}
              </p>
            ) : null}

            {publishPaymentWaiting ? (
              <div className="rounded-lg border border-zinc-200 bg-white/70 px-4 py-3 text-left dark:border-zinc-700 dark:bg-zinc-900/60">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-500 dark:border-zinc-600 dark:border-t-emerald-400"
                  />
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Waiting for payment...
                  </p>
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  This usually takes a few seconds
                </p>
              </div>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {submitting ? 'Saving…' : isEditMode ? 'Save changes' : 'Create post'}
              </button>
            )}
            </div>
          </div>
        </form>
      </main>

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
