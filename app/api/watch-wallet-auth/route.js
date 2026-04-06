import { ChronikClient } from 'chronik-client'
import { getOutputScriptFromAddress } from 'ecashaddrjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
  if (!platformAddress) {
    return new Response(
      JSON.stringify({ error: 'Platform payment address not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let platformOutputScript
  try {
    platformOutputScript = getOutputScriptFromAddress(platformAddress)
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid platform payment address' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
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
        try {
          ws = chronik.ws({
            onMessage: async (msg) => {
              if (closed) return
              if (msg.type !== 'Tx' || msg.msgType !== 'TX_ADDED_TO_MEMPOOL') return
              const txid = msg.txid
              if (!txid) return

              try {
                const tx = await chronik.tx(txid)
                const hasPlatformOutput = tx.outputs?.some(
                  (output) => output.outputScript === platformOutputScript,
                )
                if (!hasPlatformOutput) return
              } catch {
                return
              }

              send({ txid })
              request.signal.removeEventListener('abort', onAbort)
              cleanup()
            },
          })

          await ws.waitForOpen()
          ws.subscribeToAddress(platformAddress)
        } catch (err) {
          send({
            error: err?.message || 'Failed to open wallet auth stream',
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
