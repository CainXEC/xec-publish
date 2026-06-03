'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { warmOgImageForPost } from '@/app/dashboard/warmOgImage'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function publishDraftPost(formData) {
  const rawId = formData.get('postId')
  const postId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!postId) {
    redirect('/dashboard')
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data, error } = await supabase
    .from('posts')
    .update({ published: true })
    .eq('id', postId)
    .eq('author_id', user.id)
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
