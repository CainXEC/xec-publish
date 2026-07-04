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
  const { data, error } = await supabase
    .from('posts')
    .update({ published: true })
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
  redirect('/dashboard')
}
