export const runtime = 'nodejs'

import { ChronikClient } from 'chronik-client'
import { supabase } from '@/lib/supabase'
import { verifyAndRecordUnlock } from '@/lib/verifyPaymentUnlock'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { postId } = await params

  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id, price_xec, author_id, published, authors!inner(xec_address)')
    .eq('id', postId)
    .maybeSingle()

  if (postError || !post) {
    return new Response(
      JSON.stringify({ error: postError?.message || 'Post not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (!post.published) {
    return new Response(JSON.stringify({ error: 'Post not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const author = Array.isArray(post.authors) ? post.authors[0] : post.authors

  if (!author?.xec_address) {
    return new Response(
      JSON.stringify({ error: 'Author payment address not found' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const encoder = new TextEncoder()
  let ws
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
          )
        } catch {
          /* stream closed */
        }
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      }

      const onAbort = () => cleanup()
      request.signal.addEventListener('abort', onAbort)

      const chronik = new ChronikClient(['https://chronik.e.cash'])

      void (async () => {
        let inFlight = false
        try {
          ws = chronik.ws({
            onMessage: async (msg) => {
              if (closed || inFlight) return
              if (msg.type !== 'Tx' || msg.msgType !== 'TX_ADDED_TO_MEMPOOL') {
                return
              }
              const txid = msg.txid
              if (!txid) return

              inFlight = true
              try {
                const result = await verifyAndRecordUnlock({
                  chronik,
                  txid,
                  postId,
                  authorXecAddress: author.xec_address,
                  priceXec: post.price_xec,
                  options: {
                    verbose: false,
                    logPrefix: '[watch-payment]',
                  },
                })

                if (result.ok) {
                  send({ unlocked: true, txid: result.txid })
                  request.signal.removeEventListener('abort', onAbort)
                  cleanup()
                  return
                }
              } finally {
                inFlight = false
              }
            },
          })

          await ws.waitForOpen()
          ws.subscribeToAddress(author.xec_address)
        } catch (err) {
          send({
            error:
              err?.message ||
              'Failed to open Chronik WebSocket or subscribe to address',
          })
          request.signal.removeEventListener('abort', onAbort)
          cleanup()
        }
      })()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
