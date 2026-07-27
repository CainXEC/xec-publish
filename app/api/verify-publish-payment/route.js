export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { getOutputScriptFromAddress } from 'ecashaddrjs'
import { decodeOpReturnToPostId } from '@/lib/opReturnEncode'
import { decodeFeedOpReturn, contentHashHex, FEED_ACTION } from '@/lib/feedProtocol'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { CHRONIK_URLS } from '@/lib/ecash/chronikEndpoints'

const chronik = new ChronikClient(CHRONIK_URLS)

const PUBLISH_FEE_SATS = 100_000 // 1,000 XEC one-time publish fee
const LOG_PREFIX = '[verify-publish-payment]'

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
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 10, 60, 'verify-publish-payment'))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
    const postId = typeof body?.postId === 'string' ? body.postId.trim() : ''

    if (!txid || !postId) {
      return NextResponse.json(
        { error: 'Missing txid or postId' },
        { status: 400 },
      )
    }

    const acct = await getAuthedAccount()
    if (!acct?.authorId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const authorId = acct.authorId

    const admin = adminDb()
    if (!admin) {
      return NextResponse.json(
        { error: 'Server configuration error: missing Supabase admin credentials' },
        { status: 500 },
      )
    }

    const { data: post, error: postError } = await admin
      .from('posts')
      .select('id, author_id, publish_paid, body')
      .eq('id', postId)
      .maybeSingle()

    if (postError) {
      return NextResponse.json({ error: postError.message }, { status: 500 })
    }
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    if (post.author_id !== authorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (post.publish_paid === true) {
      return NextResponse.json({ already_paid: true }, { status: 200 })
    }

    const { data: existingPublish, error: publishLookupError } = await admin
      .from('publishes')
      .select('id')
      .eq('txid', txid)
      .maybeSingle()

    if (publishLookupError) {
      return NextResponse.json({ error: publishLookupError.message }, { status: 500 })
    }
    if (existingPublish) {
      return NextResponse.json(
        { error: 'This transaction was already used.' },
        { status: 400 },
      )
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
      console.log(`${LOG_PREFIX} tx fetched, outputs:`, tx.outputs?.length ?? 0)
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
    // The new POWR publish envelope (OP_6) commits sha256 of the stored body —
    // the article's "proof of writing". We recompute it here and compare, never
    // trusting a client-sent value. The legacy layout carried the bare postId;
    // accept it too so a payment started before this deploy still verifies.
    const expectedHash = contentHashHex(post.body ?? '')
    let powrPublishHash = null
    let legacyDecoded = null
    for (const o of outputs) {
      const hex = outputScriptToHex(o.outputScript)
      if (!hex.startsWith('6a')) continue
      const powr = decodeFeedOpReturn(hex)
      if (powr && powr.action === FEED_ACTION.PUBLISH) {
        powrPublishHash = String(powr.contentHash ?? '').toLowerCase()
        break
      }
      legacyDecoded = decodeOpReturnToPostId(hex)
      break
    }

    if (powrPublishHash != null) {
      if (powrPublishHash !== expectedHash) {
        return NextResponse.json(
          { error: 'Payment OP_RETURN does not match this post' },
          { status: 400 },
        )
      }
    } else {
      const decodedNorm =
        legacyDecoded != null
          ? String(legacyDecoded).trim().toLowerCase()
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
    }

    const platformHex = outputScriptToHex(platformOutputScript)
    const platformPayouts = outputs.filter((o) => {
      if (Number(o.sats) !== PUBLISH_FEE_SATS) return false
      return outputScriptToHex(o.outputScript) === platformHex
    })

    if (platformPayouts.length === 0) {
      return NextResponse.json(
        {
          error: `Publish fee not found: need exactly ${PUBLISH_FEE_SATS} sats to platform address`,
        },
        { status: 400 },
      )
    }
    if (platformPayouts.length > 1) {
      return NextResponse.json(
        { error: 'Invalid transaction: multiple platform fee outputs' },
        { status: 400 },
      )
    }

    const { data: inserted, error: insertError } = await admin
      .from('publishes')
      .insert({
        post_id: postId,
        author_id: authorId,
        txid,
        amount_sats: PUBLISH_FEE_SATS,
      })
      .select('id')
      .single()

    if (insertError) {
      if (String(insertError.message || '').includes('duplicate') || insertError.code === '23505') {
        return NextResponse.json(
          { error: 'This transaction was already used.' },
          { status: 400 },
        )
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const { error: updateError } = await admin
      .from('posts')
      .update({ publish_paid: true })
      .eq('id', postId)

    if (updateError) {
      if (inserted?.id) {
        await admin.from('publishes').delete().eq('id', inserted.id)
      }
      return NextResponse.json({ error: updateError.message }, { status: 500 })
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
