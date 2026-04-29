export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyCookieValue } from '@/lib/cookieSigner'
import { AUDIO_STORAGE_BUCKET } from '@/lib/audioConfig'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabase, createSupabaseServerClient } from '@/lib/supabase-server'

const SIGNED_URL_TTL_SECONDS = 60 * 15

export async function GET(request) {
  const postId = request.nextUrl.searchParams.get('post_id')?.trim()
  if (!postId) {
    return NextResponse.json({ error: 'Missing post_id' }, { status: 400 })
  }

  const supabase = createServerSupabase()
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id, author_id, audio_url')
    .eq('id', postId)
    .limit(1)
    .maybeSingle()

  if (postError) {
    return NextResponse.json({ error: postError.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  let isAuthor = false
  let isAdmin = false
  let userId = null
  try {
    const supabaseAuth = await createSupabaseServerClient()
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser()
    if (!userError && userData?.user?.id) {
      userId = userData.user.id
      if (userData.user.id === post.author_id) {
        isAuthor = true
      }
    }
  } catch {
    isAuthor = false
  }

  if (userId && !isAuthor) {
    const supabaseAdmin = createSupabaseAdminClient()
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin client is not configured' }, { status: 500 })
    }
    const { data: authorRow, error: authorError } = await supabaseAdmin
      .from('authors')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle()
    if (authorError) {
      return NextResponse.json({ error: authorError.message }, { status: 500 })
    }
    isAdmin = authorRow?.is_admin === true
  }

  if (!isAuthor && !isAdmin) {
    let hasValidUnlock = false
    let hadCookieContext = false
    const rawCookie = request.cookies.get(`unlock_${postId}`)?.value
    if (rawCookie) {
      hadCookieContext = true
      const { valid, txid } = verifyCookieValue(postId, rawCookie)
      if (valid && txid) {
        const { data: unlockByTxid, error: unlockByTxidError } = await supabase
          .from('unlocks')
          .select('id')
          .eq('post_id', postId)
          .eq('txid', txid)
          .limit(1)
          .maybeSingle()
        if (unlockByTxidError) {
          return NextResponse.json({ error: unlockByTxidError.message }, { status: 500 })
        }
        hasValidUnlock = Boolean(unlockByTxid)
      }
    }

    if (!hasValidUnlock) {
      if (hadCookieContext) {
        return NextResponse.json({ error: 'Post is not unlocked for this reader' }, { status: 403 })
      }

      const walletAddress = request.nextUrl.searchParams.get('walletAddress')?.trim()
      if (!walletAddress) {
        return NextResponse.json({ error: 'Reader context required' }, { status: 401 })
      }

      const { data: unlockByWallet, error: unlockByWalletError } = await supabase
        .from('unlocks')
        .select('id')
        .eq('post_id', postId)
        .eq('payer_address', walletAddress)
        .limit(1)
        .maybeSingle()

      if (unlockByWalletError) {
        return NextResponse.json({ error: unlockByWalletError.message }, { status: 500 })
      }

      if (!unlockByWallet) {
        return NextResponse.json({ error: 'Post is not unlocked for this reader' }, { status: 403 })
      }
    }
  }

  const audioPath = typeof post?.audio_url === 'string' ? post.audio_url.trim() : ''
  if (!audioPath) {
    return NextResponse.json({ error: 'Audio not found for this post' }, { status: 404 })
  }

  const supabaseAdmin = createSupabaseAdminClient()
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin client is not configured' }, { status: 500 })
  }

  const { data: signedData, error: signedError } = await supabaseAdmin.storage
    .from(AUDIO_STORAGE_BUCKET)
    .createSignedUrl(audioPath, SIGNED_URL_TTL_SECONDS)

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      { error: signedError?.message || 'Could not generate signed audio URL' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    url: signedData.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  })
}
