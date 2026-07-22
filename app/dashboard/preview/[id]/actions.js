'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { warmOgImageForPost } from '@/app/dashboard/warmOgImage'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

export async function publishDraftPost(formData) {
  const rawId = formData.get('postId')
  const postId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!postId) {
    redirect('/dashboard')
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    redirect('/dashboard')
  }

  // Same server-side gate as savePost's nextPublished branch: going live
  // requires a paid, owned draft. Without this the preview button was a
  // publish-fee bypass — it flipped published=true for any unpaid draft.
  const { data: existing, error: exErr } = await supabase
    .from('posts')
    .select('id, slug, publish_paid, published_at')
    .eq('id', postId)
    .eq('author_id', acct.authorId)
    .maybeSingle()

  if (exErr || !existing) {
    redirect('/dashboard')
  }

  if (existing.publish_paid !== true) {
    // Plain <form action> — there's no client handler to hand a needsPayment
    // result to, so the outcome rides back to the preview page as a flag.
    redirect(`/dashboard/preview/${encodeURIComponent(postId)}?needsPayment=1`)
  }

  const payload = { published: true }
  if (!existing.published_at) {
    payload.published_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('posts')
    .update(payload)
    .eq('id', postId)
    .eq('author_id', acct.authorId)
    .select('id')
    .maybeSingle()

  if (error || !data) {
    redirect('/dashboard')
  }

  await warmOgImageForPost(postId)

  revalidatePath('/dashboard')
  revalidatePath('/')
  // Land on the freshly published article — "you published, here it is" — rather
  // than the dashboard or (worse) back in the editor. Fall back to the dashboard
  // only if the slug is somehow missing.
  const slug = typeof existing.slug === 'string' ? existing.slug.trim() : ''
  redirect(slug ? `/posts/${encodeURIComponent(slug)}` : '/dashboard')
}
