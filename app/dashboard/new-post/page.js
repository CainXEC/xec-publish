import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import NewPostForm from '@/components/dashboard/NewPostForm'

export default async function NewPostPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: author } = await supabase
    .from('authors')
    .select('xec_address')
    .eq('id', user.id)
    .maybeSingle()

  return <NewPostForm xecAddress={author?.xec_address ?? ''} />
}
