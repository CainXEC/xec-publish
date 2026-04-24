export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { getOutputScriptFromAddress } from 'ecashaddrjs'
import { decodeOpReturnToPostId } from '@/lib/opReturnEncode'
import { rateLimit } from '@/lib/rateLimit'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getAudioPriceForPost, getPlainTextCharCount } from '@/lib/audioConfig'

const LOG_PREFIX = '[verify-audio-payment]'

const chronik = new ChronikClient([
  'https://chronik.e.cash',
  'https://chronik-native1.fabien.cash',
  'https://chronik-native2.fabien.cash',
  'https://chronik-native3.fabien.cash',
])

function outputScriptToHex(outputScript) {
  if (outputScript == null) return ''
  if (typeof outputScript === 'string') {
    const t = outputScript.trim().replace(/^0x/i, '')
    if (/^[0-9a-f]+$/i.test(t)) return t.toLowerCase()
    return ''
  }
  if (outputScript instanceof Uint8Array) {
    let s = ''
    for (let j = 0; j < outputScript.length; j++) {
      s += outputScript[j].toString(16).padStart(2, '0')
    }
    return s
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(outputScript)) {
    return outputScript.toString('hex')
  }
  return ''
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(ip, 10, 60, 'verify-audio-payment'))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
    const postId = typeof body?.post_id === 'string' ? body.post_id.trim() : ''

    if (!txid || !postId) {
      return NextResponse.json(
        { error: 'Missing txid or post_id' },
        { status: 400 },
      )
    }

    const supabaseAuth = await createSupabaseServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser()

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createSupabaseAdminClient()
    if (!admin) {
      return NextResponse.json(
        { error: 'Server configuration error: missing Supabase admin credentials' },
        { status: 500 },
      )
    }

    const { data: post, error: postError } = await admin
      .from('posts')
      .select('id, author_id, body, audio_url')
      .eq('id', postId)
      .maybeSingle()

    if (postError) {
      return NextResponse.json({ error: postError.message }, { status: 500 })
    }
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    if (post.author_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (post.audio_url) {
      return NextResponse.json({ already_paid: true }, { status: 200 })
    }

    const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
    if (!platformAddress) {
      return NextResponse.json(
        { error: 'Platform payment address not configured' },
        { status: 500 },
      )
    }

    let platformOutputScript
    try {
      platformOutputScript = getOutputScriptFromAddress(platformAddress)
    } catch {
      return NextResponse.json(
        { error: 'Invalid platform payment address' },
        { status: 500 },
      )
    }

    const charCount = getPlainTextCharCount(post.body)
    const expectedAmountSats = Math.round(getAudioPriceForPost(charCount) * 100)

    let tx
    try {
      const txPromise = chronik.tx(txid)
      let timeoutId
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Chronik tx fetch timed out after 10s')),
          10_000,
        )
      })
      try {
        tx = await Promise.race([txPromise, timeoutPromise])
      } finally {
        clearTimeout(timeoutId)
      }
      console.log(`${LOG_PREFIX} tx fetched`, { txid, outputs: tx.outputs?.length ?? 0 })
    } catch (e) {
      console.log(`${LOG_PREFIX} chronik.tx error:`, e?.message)
      return NextResponse.json(
        { error: e?.message || 'Failed to fetch transaction' },
        { status: 400 },
      )
    }

    const outputs = (tx.outputs ?? []).map((o) => ({
      sats: Number(o.sats),
      outputScript: o.outputScript,
    }))

    const expectedPostId = postId.toLowerCase()
    let opReturnDecoded = null
    for (const o of outputs) {
      const hex = outputScriptToHex(o.outputScript)
      if (!hex.startsWith('6a')) continue
      opReturnDecoded = decodeOpReturnToPostId(hex)
      break
    }

    const decodedNorm =
      opReturnDecoded != null
        ? String(opReturnDecoded).trim().toLowerCase()
        : null

    if (decodedNorm == null || decodedNorm === '') {
      return NextResponse.json(
        { error: 'Payment missing post identifier' },
        { status: 400 },
      )
    }
    if (decodedNorm !== expectedPostId) {
      return NextResponse.json(
        { error: 'Payment OP_RETURN does not match this post' },
        { status: 400 },
      )
    }

    const platformHex = outputScriptToHex(platformOutputScript)
    const paidOutput = outputs.find((o) => {
      if (!Number.isFinite(o.sats)) return false
      if (o.sats < expectedAmountSats) return false
      return outputScriptToHex(o.outputScript) === platformHex
    })

    if (!paidOutput) {
      return NextResponse.json(
        {
          error: `Audio fee not found: need at least ${expectedAmountSats} sats to platform address`,
        },
        { status: 400 },
      )
    }

    const { data: existingPayment } = await admin
      .from('audio_payments')
      .select('txid')
      .eq('txid', txid)
      .maybeSingle()
    if (existingPayment?.txid) {
      return NextResponse.json({ error: 'txid_already_used' }, { status: 409 })
    }

    return NextResponse.json({ paid: true }, { status: 200 })
  } catch (err) {
    console.log(`${LOG_PREFIX} caught error`, {
      message: err?.message,
      stack: err?.stack,
    })
    return NextResponse.json(
      {
        error: `Verification failed: ${err?.message || 'Payment verification failed'}`,
      },
      { status: 500 },
    )
  }
}
