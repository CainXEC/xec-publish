export const runtime = 'nodejs'

import textToSpeech from '@google-cloud/text-to-speech'
import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { getOutputScriptFromAddress } from 'ecashaddrjs'
import { decodeOpReturnToPostId } from '@/lib/opReturnEncode'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  AUDIO_MAX_TOTAL_CHARS,
  AUDIO_STORAGE_BUCKET,
  getAudioPriceForPost,
  getPlainTextCharCount,
  getPlainTextFromHtml,
  hashPostBody,
} from '@/lib/audioConfig'
import { chunkTextForTTS } from '@/lib/audioChunking'

const LOG_PREFIX = '[audio-generate]'

const VOICE_MAP = {
  male: 'en-US-Chirp3-HD-Iapetus',
  female: 'en-US-Chirp3-HD-Laomedeia',
}

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

async function verifyAudioPayment({ txid, postId, expectedAmountSats }) {
  const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
  if (!platformAddress) {
    return { ok: false, error: 'Platform payment address not configured', status: 500 }
  }

  let platformOutputScript
  try {
    platformOutputScript = getOutputScriptFromAddress(platformAddress)
  } catch {
    return { ok: false, error: 'Invalid platform payment address', status: 500 }
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
    console.log(`${LOG_PREFIX} payment tx fetched`, {
      txid,
      outputCount: tx.outputs?.length ?? 0,
    })
  } catch (err) {
    return {
      ok: false,
      error: `Failed to fetch transaction: ${err?.message || 'chronik error'}`,
      status: 400,
    }
  }

  const outputs = (tx.outputs ?? []).map((o) => ({
    sats: Number(o.sats),
    outputScript: o.outputScript,
  }))

  const expectedPostId = String(postId ?? '').trim().toLowerCase()
  let decoded = null
  for (const o of outputs) {
    const hex = outputScriptToHex(o.outputScript)
    if (!hex.startsWith('6a')) continue
    decoded = decodeOpReturnToPostId(hex)
    break
  }
  const decodedNorm =
    decoded != null ? String(decoded).trim().toLowerCase() : null
  if (!decodedNorm || decodedNorm !== expectedPostId) {
    return {
      ok: false,
      error: 'Payment OP_RETURN does not match this post',
      status: 402,
    }
  }

  const platformHex = outputScriptToHex(platformOutputScript)
  const platformOutput = outputs.find((o) => {
    if (!Number.isFinite(o.sats)) return false
    if (o.sats < expectedAmountSats) return false
    return outputScriptToHex(o.outputScript) === platformHex
  })

  if (!platformOutput) {
    return {
      ok: false,
      error: `Insufficient payment: expected at least ${expectedAmountSats} sats to platform address`,
      status: 402,
    }
  }

  return { ok: true }
}

export async function POST(request) {
  console.log(`${LOG_PREFIX} start`)

  const body = await request.json().catch(() => ({}))
  const postId = typeof body?.post_id === 'string' ? body.post_id.trim() : ''
  const paymentTxid =
    typeof body?.payment_txid === 'string' ? body.payment_txid.trim() : ''
  const voicePreference = body?.voice_preference === 'male' ? 'male' : 'female'

  if (!postId) {
    return NextResponse.json({ error: 'missing_post_id' }, { status: 400 })
  }
  if (!paymentTxid) {
    return NextResponse.json({ error: 'missing_payment_txid' }, { status: 400 })
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

  const supabaseAdmin = createSupabaseAdminClient()
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }

  const { data: post, error: postError } = await supabaseAdmin
    .from('posts')
    .select('id, author_id, title, body, audio_url, audio_source_hash')
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

  const plainText = getPlainTextFromHtml(post.body)
  const titleText = getPlainTextFromHtml(post.title)
  const ttsInput = titleText ? `${titleText}\n\n${plainText}` : plainText
  const charCount = getPlainTextCharCount(post.body)
  const sourceHash = hashPostBody(post.body)
  const expectedPriceXec = getAudioPriceForPost(charCount)
  const expectedAmountSats = Math.round(expectedPriceXec * 100)

  console.log(`${LOG_PREFIX} post loaded`, {
    postId,
    charCount,
    expectedPriceXec,
    expectedAmountSats,
  })

  const paymentVerification = await verifyAudioPayment({
    txid: paymentTxid,
    postId,
    expectedAmountSats,
  })
  if (!paymentVerification.ok) {
    console.log(`${LOG_PREFIX} payment verification failed`, {
      postId,
      txid: paymentTxid,
      error: paymentVerification.error,
    })
    return NextResponse.json(
      { error: 'payment_required', detail: paymentVerification.error },
      { status: paymentVerification.status ?? 402 },
    )
  }
  console.log(`${LOG_PREFIX} payment verified`, { postId, txid: paymentTxid })

  const { data: existingAudioPayment } = await supabaseAdmin
    .from('audio_payments')
    .select('txid')
    .eq('txid', paymentTxid)
    .maybeSingle()
  if (existingAudioPayment?.txid) {
    return NextResponse.json({ error: 'txid_already_used' }, { status: 409 })
  }

  if (!plainText) {
    return NextResponse.json(
      { error: 'audio_generation_failed', detail: 'Post body is empty after HTML stripping' },
      { status: 400 },
    )
  }

  if (ttsInput.length > AUDIO_MAX_TOTAL_CHARS) {
    return NextResponse.json(
      {
        error: 'post_too_long',
        detail: `Posts longer than ${AUDIO_MAX_TOTAL_CHARS.toLocaleString('en-US')} characters aren't supported for audio. This post is ${ttsInput.length.toLocaleString('en-US')} characters.`,
      },
      { status: 400 },
    )
  }

  const chunks = chunkTextForTTS(ttsInput)
  if (chunks.length === 0) {
    return NextResponse.json(
      { error: 'audio_generation_failed', detail: 'No TTS input after chunking' },
      { status: 400 },
    )
  }

  if (!process.env.GOOGLE_TTS_API_KEY) {
    return NextResponse.json(
      { error: 'audio_generation_failed', detail: 'GOOGLE_TTS_API_KEY is not configured' },
      { status: 500 },
    )
  }

  const ttsClient = new textToSpeech.TextToSpeechClient({
    apiKey: process.env.GOOGLE_TTS_API_KEY,
  })

  const selectedVoice = VOICE_MAP[voicePreference]

  console.log(`${LOG_PREFIX} tts chunks`, {
    postId,
    chunkCount: chunks.length,
    ttsChars: ttsInput.length,
    voice: selectedVoice,
  })

  const ttsStartedAt = Date.now()
  let chunkResults
  try {
    chunkResults = await Promise.all(
      chunks.map(async (chunk, i) => {
        const chunkStart = Date.now()
        console.log(`${LOG_PREFIX} google tts chunk start`, {
          postId,
          chunkIndex: i,
          chunkChars: chunk.length,
        })
        try {
          const [response] = await ttsClient.synthesizeSpeech({
            input: { text: chunk },
            voice: {
              languageCode: 'en-US',
              name: selectedVoice,
            },
            audioConfig: {
              audioEncoding: 'MP3',
            },
          })
          const buffer = Buffer.from(response.audioContent)
          const chunkElapsedMs = Date.now() - chunkStart
          console.log(`[audio-gen] chunk ${i + 1}/${chunks.length} took ${chunkElapsedMs}ms`)
          console.log(`${LOG_PREFIX} google tts chunk success`, {
            postId,
            chunkIndex: i,
            elapsedMs: chunkElapsedMs,
            bytes: buffer.length,
          })
          return { index: i, buffer, elapsedMs: chunkElapsedMs }
        } catch (error) {
          console.error(`[audio-gen] chunk ${i + 1}/${chunks.length} failed`, error)
          const wrapped = new Error(
            error?.message || 'Google TTS generation failed',
          )
          wrapped.chunkIndex = i
          wrapped.cause = error
          throw wrapped
        }
      }),
    )
  } catch (err) {
    const chunkIdx = typeof err.chunkIndex === 'number' ? err.chunkIndex : null
    console.error(`${LOG_PREFIX} google tts chunk failed`, {
      postId,
      chunkIndex: chunkIdx,
      chunkCount: chunks.length,
      message: err?.message,
    })
    const detail =
      chunkIdx != null
        ? `TTS failed on chunk ${chunkIdx + 1} of ${chunks.length}: ${err?.message || 'Google TTS generation failed'}`
        : `TTS failed: ${err?.message || 'Google TTS generation failed'}`
    return NextResponse.json({ error: 'audio_generation_failed', detail }, { status: 500 })
  }

  const allBuffers = chunkResults.map((r) => r.buffer)
  const audioBuffer = Buffer.concat(allBuffers)
  console.log(`${LOG_PREFIX} google tts all chunks done`, {
    postId,
    chunkCount: chunks.length,
    totalMs: Date.now() - ttsStartedAt,
    totalBytes: audioBuffer.length,
  })

  const fileName = `${post.id}.mp3`
  const { error: uploadError } = await supabaseAdmin.storage
    .from(AUDIO_STORAGE_BUCKET)
    .upload(fileName, audioBuffer, {
      contentType: 'audio/mpeg',
      upsert: true,
    })

  if (uploadError) {
    console.error(`${LOG_PREFIX} storage upload failed`, {
      postId,
      message: uploadError.message,
    })
    return NextResponse.json(
      { error: 'audio_generation_failed', detail: uploadError.message },
      { status: 500 },
    )
  }
  console.log(`${LOG_PREFIX} storage upload success`, { postId, fileName })

  const { error: insertPaymentError } = await supabaseAdmin
    .from('audio_payments')
    .insert({ txid: paymentTxid, post_id: post.id })

  if (insertPaymentError) {
    if (insertPaymentError.code === '23505') {
      return NextResponse.json({ error: 'txid_already_used' }, { status: 409 })
    }
    console.error(`${LOG_PREFIX} audio_payments insert failed`, {
      postId,
      txid: paymentTxid,
      message: insertPaymentError.message,
      code: insertPaymentError.code,
    })
    return NextResponse.json(
      { error: 'audio_generation_failed', detail: insertPaymentError.message },
      { status: 500 },
    )
  }

  const { error: updateError } = await supabaseAdmin
    .from('posts')
    .update({
      audio_url: fileName,
      audio_generated_at: new Date().toISOString(),
      audio_char_count: charCount,
      audio_source_hash: sourceHash,
      audio_voice: voicePreference,
    })
    .eq('id', post.id)

  if (updateError) {
    console.error(`${LOG_PREFIX} post update failed`, {
      postId,
      message: updateError.message,
    })
    return NextResponse.json(
      { error: 'audio_generation_failed', detail: updateError.message },
      { status: 500 },
    )
  }
  console.log(`${LOG_PREFIX} post update success`, { postId, fileName })

  return NextResponse.json({
    ok: true,
    post_id: post.id,
    audio_url: fileName,
    char_count: charCount,
    voice: voicePreference,
  })
}