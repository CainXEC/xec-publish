'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import RichTextEditor from '@/components/RichTextEditor'
import { supabase } from '@/lib/supabase-browser'
import { postBodyHasMeaningfulText } from '@/lib/sanitizePostBodyHtml'

export default function EditPostForm({ postId, xecAddress: initialXecAddress, initialPost }) {
  const router = useRouter()
  const bodyLabelId = useId()
  const [xecAddress] = useState(initialXecAddress ?? '')

  const [title, setTitle] = useState(initialPost.title ?? '')
  const [slug, setSlug] = useState(initialPost.slug ?? '')
  const [teaser, setTeaser] = useState(initialPost.teaser ?? '')
  const [body, setBody] = useState(initialPost.body ?? '')
  const [priceXec, setPriceXec] = useState(
    initialPost.price_xec != null && initialPost.price_xec !== ''
      ? String(initialPost.price_xec)
      : '100',
  )
  const [published, setPublished] = useState(Boolean(initialPost.published))

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) {
        setSubmitError(userError.message)
        return
      }
      const user = userData.user
      if (!user) {
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

      const { data: updated, error: updateError } = await supabase
        .from('posts')
        .update({
          title: title.trim(),
          slug: slug.trim(),
          teaser: teaser.trim(),
          body: body.trim(),
          price_xec: price,
          published,
        })
        .eq('id', postId)
        .eq('author_id', user.id)
        .select('id')
        .maybeSingle()

      if (updateError) {
        setSubmitError(updateError.message)
        return
      }

      if (!updated) {
        setSubmitError('Could not update this post. It may have been deleted.')
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
      <main className="mx-auto w-full max-w-2xl">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
        >
          ← Back to dashboard
        </Link>

        <div className="mt-6 mb-6">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Edit post</h1>
        </div>

        {xecAddress ? (
          <p className="mb-6 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Payout address (XEC):</span>{' '}
            <span className="font-mono text-zinc-900 dark:text-zinc-100">{xecAddress}</span>
          </p>
        ) : (
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            No XEC address on file. Add one in your author profile if your app supports it.
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
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
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Slug{' '}
                <span className="font-normal text-zinc-500">(URL path, e.g. my-first-post)</span>
              </label>
              <input
                id="slug"
                name="slug"
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="teaser" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Teaser
              </label>
              <textarea
                id="teaser"
                name="teaser"
                required
                rows={4}
                value={teaser}
                onChange={(e) => setTeaser(e.target.value)}
                className="mt-1 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
                placeholder="Free preview shown before payment"
              />
            </div>

            <div>
              <span
                id={bodyLabelId}
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Body
              </span>
              <RichTextEditor
                key={postId}
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

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
