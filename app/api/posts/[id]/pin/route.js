export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

async function requireAdminUser() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return {
      error: NextResponse.json(
        { error: 'Server configuration error: missing Supabase admin credentials' },
        { status: 500 },
      ),
    }
  }

  const { data: authorRow, error: authorError } = await admin
    .from('authors')
    .select('is_admin')
    .eq('id', acct.authorId)
    .maybeSingle()

  if (authorError) {
    return { error: NextResponse.json({ error: authorError.message }, { status: 500 }) }
  }
  if (authorRow?.is_admin !== true) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { admin }
}

export async function POST(_request, context) {
  const id = (await context.params)?.id
  const postId = typeof id === 'string' ? id.trim() : ''
  if (!postId) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 })
  }

  const gate = await requireAdminUser()
  if (gate.error) return gate.error
  const { admin } = gate

  const { error: clearError } = await admin.from('posts').update({ pinned: false }).eq('pinned', true)
  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 })
  }

  const { error: pinError } = await admin.from('posts').update({ pinned: true }).eq('id', postId)
  if (pinError) {
    return NextResponse.json({ error: pinError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request, context) {
  const id = (await context.params)?.id
  const postId = typeof id === 'string' ? id.trim() : ''
  if (!postId) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 })
  }

  const gate = await requireAdminUser()
  if (gate.error) return gate.error
  const { admin } = gate

  const { error: unpinError } = await admin.from('posts').update({ pinned: false }).eq('id', postId)
  if (unpinError) {
    return NextResponse.json({ error: unpinError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
