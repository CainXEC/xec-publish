import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression tests for the preview-page publish-fee bypass: publishDraftPost
// used to flip published=true for any owned draft WITHOUT checking
// publish_paid and WITHOUT stamping published_at — a free publish for anyone
// who opened /dashboard/preview/<id> on an unpaid draft. It must enforce the
// same gate as savePost's nextPublished branch: unpaid → needsPayment outcome
// (redirect back to the preview with ?needsPayment=1, no write), paid →
// publish + stamp published_at exactly once.
const db = vi.hoisted(() => {
  const state = {
    lastUpdatePayload: null,
    existingRow: { id: 'post-1', publish_paid: true, published_at: null },
    updateResult: { data: { id: 'post-1' }, error: null },
  }
  const from = vi.fn(() => ({
    // publish-gate lookup: .select(...).eq('id').eq('author_id').maybeSingle()
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: state.existingRow, error: null })),
        })),
      })),
    })),
    // publish write: .update(payload).eq('id').eq('author_id').select('id').maybeSingle()
    update: vi.fn((payload) => {
      state.lastUpdatePayload = payload
      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => state.updateResult),
            })),
          })),
        })),
      }
    }),
  }))
  return { from, state }
})

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: db.from })),
}))

const getAuthedAccount = vi.fn(async () => ({ authorId: 'author-1', accountId: 'acct-1' }))
vi.mock('@/lib/authHelpers', () => ({ getAuthedAccount }))

// Mirror next/navigation's real control flow: redirect() throws, so nothing
// after a failed gate can run. The URL rides in the message for assertions.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url) => {
    const err = new Error(`NEXT_REDIRECT:${url}`)
    err.digest = `NEXT_REDIRECT;replace;${url};307;`
    throw err
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const warmOgImageForPost = vi.fn(async () => {})
vi.mock('@/app/dashboard/warmOgImage', () => ({ warmOgImageForPost }))

function makeFormData(entries = {}) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

// The action never returns — every path ends in a redirect throw. Run it,
// catch the sentinel, and hand back the target URL.
async function redirectTargetOf(promise) {
  try {
    await promise
  } catch (e) {
    const msg = String(e?.message ?? '')
    if (msg.startsWith('NEXT_REDIRECT:')) {
      return msg.slice('NEXT_REDIRECT:'.length)
    }
    throw e
  }
  throw new Error('expected publishDraftPost to redirect, but it returned')
}

describe('publishDraftPost publish-fee gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.state.lastUpdatePayload = null
    db.state.existingRow = { id: 'post-1', publish_paid: true, published_at: null }
    db.state.updateResult = { data: { id: 'post-1' }, error: null }
  })

  it('unpaid draft is NOT published — needsPayment redirect, no write (fee bypass regression)', async () => {
    db.state.existingRow.publish_paid = false
    const { publishDraftPost } = await import('@/app/dashboard/preview/[id]/actions')
    const target = await redirectTargetOf(
      publishDraftPost(makeFormData({ postId: 'post-1' })),
    )
    expect(target).toBe('/dashboard/preview/post-1?needsPayment=1')
    expect(db.state.lastUpdatePayload).toBeNull()
    expect(warmOgImageForPost).not.toHaveBeenCalled()
  })

  it('paid draft publishes and stamps published_at', async () => {
    const { publishDraftPost } = await import('@/app/dashboard/preview/[id]/actions')
    const target = await redirectTargetOf(
      publishDraftPost(makeFormData({ postId: 'post-1' })),
    )
    expect(target).toBe('/dashboard')
    expect(db.state.lastUpdatePayload.published).toBe(true)
    expect(typeof db.state.lastUpdatePayload.published_at).toBe('string')
    expect(warmOgImageForPost).toHaveBeenCalledWith('post-1')
  })

  it('published_at is stamped only once — an existing stamp is never overwritten', async () => {
    db.state.existingRow.published_at = '2026-01-01T00:00:00.000Z'
    const { publishDraftPost } = await import('@/app/dashboard/preview/[id]/actions')
    const target = await redirectTargetOf(
      publishDraftPost(makeFormData({ postId: 'post-1' })),
    )
    expect(target).toBe('/dashboard')
    expect(db.state.lastUpdatePayload.published).toBe(true)
    expect('published_at' in db.state.lastUpdatePayload).toBe(false)
  })

  it('signed-out caller bounces to /login without touching the database', async () => {
    getAuthedAccount.mockResolvedValueOnce(null)
    const { publishDraftPost } = await import('@/app/dashboard/preview/[id]/actions')
    const target = await redirectTargetOf(
      publishDraftPost(makeFormData({ postId: 'post-1' })),
    )
    expect(target).toBe('/login')
    expect(db.from).not.toHaveBeenCalled()
  })

  it('missing or foreign post redirects to /dashboard with no publish write', async () => {
    db.state.existingRow = null // owner-scoped lookup found nothing
    const { publishDraftPost } = await import('@/app/dashboard/preview/[id]/actions')
    const target = await redirectTargetOf(
      publishDraftPost(makeFormData({ postId: 'post-other' })),
    )
    expect(target).toBe('/dashboard')
    expect(db.state.lastUpdatePayload).toBeNull()
  })

  it('missing postId redirects to /dashboard before any lookup', async () => {
    const { publishDraftPost } = await import('@/app/dashboard/preview/[id]/actions')
    const target = await redirectTargetOf(publishDraftPost(makeFormData()))
    expect(target).toBe('/dashboard')
    expect(db.from).not.toHaveBeenCalled()
  })
})
