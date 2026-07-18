import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression tests for the publish-clobber race: a new-mode autosave that
// lands AFTER the publish write must not carry `published` at all, or it
// silently unpublishes the just-published post (the telltale row state was
// published=false with published_at still set). `published` is written ONLY on
// an intentional state change: explicit publish, the edit-mode checkbox, or a
// fresh draft insert.
const db = vi.hoisted(() => {
  const updateEqAuthor = vi.fn(async () => ({ data: { id: 'post-1' }, error: null }))
  const maybeSingleUpdated = vi.fn(async () => ({ data: { id: 'post-1' }, error: null }))
  const state = {
    lastUpdatePayload: null,
    lastInsertPayload: null,
    existingRow: { id: 'post-1', author_id: 'author-1', publish_paid: true, published_at: null },
  }
  const from = vi.fn(() => ({
    // update path: .update(payload).eq('id').eq('author_id').select('id').maybeSingle()
    update: vi.fn((payload) => {
      state.lastUpdatePayload = payload
      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ maybeSingle: maybeSingleUpdated })),
          })),
        })),
      }
    }),
    // insert path: .insert(payload).select('id').single()
    insert: vi.fn((payload) => {
      state.lastInsertPayload = payload
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: 'post-new' }, error: null })),
        })),
      }
    }),
    // publish-gate lookup: .select(...).eq('id').maybeSingle()
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: state.existingRow, error: null })),
      })),
    })),
  }))
  return { from, state, updateEqAuthor }
})

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: db.from })),
}))

const getAuthedAccount = vi.fn(async () => ({ authorId: 'author-1', accountId: 'acct-1' }))
vi.mock('@/lib/authHelpers', () => ({ getAuthedAccount }))

const BODY = '<p>hello world, a meaningful body</p>'

describe('savePost published semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.state.lastUpdatePayload = null
    db.state.lastInsertPayload = null
    db.state.existingRow = { id: 'post-1', author_id: 'author-1', publish_paid: true, published_at: null }
  })

  it('new-mode UPDATE (autosave) omits `published` entirely — cannot unpublish', async () => {
    const { savePost } = await import('@/app/dashboard/savePost')
    const res = await savePost({
      forceId: 'post-1',
      nextPublished: false,
      isEditMode: false,
      published: true, // checkbox state is irrelevant outside edit mode
      title: 'T',
      body: BODY,
      priceXec: 100,
    })
    expect(res.ok).toBe(true)
    expect(db.state.lastUpdatePayload).not.toBeNull()
    expect('published' in db.state.lastUpdatePayload).toBe(false)
  })

  it('explicit publish writes published:true and stamps published_at once', async () => {
    const { savePost } = await import('@/app/dashboard/savePost')
    const res = await savePost({
      forceId: 'post-1',
      nextPublished: true,
      isEditMode: false,
      title: 'T',
      body: BODY,
      priceXec: 100,
    })
    expect(res.ok).toBe(true)
    expect(db.state.lastUpdatePayload.published).toBe(true)
    expect(typeof db.state.lastUpdatePayload.published_at).toBe('string')
  })

  it('publish is still gated on publish_paid', async () => {
    db.state.existingRow.publish_paid = false
    const { savePost } = await import('@/app/dashboard/savePost')
    const res = await savePost({
      forceId: 'post-1',
      nextPublished: true,
      isEditMode: false,
      title: 'T',
      body: BODY,
      priceXec: 100,
    })
    expect(res.ok).toBe(false)
    expect(res.needsPayment).toBe(true)
  })

  it('edit-mode save carries the explicit checkbox state (unpublish stays possible)', async () => {
    const { savePost } = await import('@/app/dashboard/savePost')
    await savePost({
      forceId: 'post-1',
      nextPublished: false,
      isEditMode: true,
      published: false,
      title: 'T',
      body: BODY,
      priceXec: 100,
    })
    expect(db.state.lastUpdatePayload.published).toBe(false)
  })

  it('action result does not echo storedBody (autosave response stays small)', async () => {
    const { savePost } = await import('@/app/dashboard/savePost')
    const res = await savePost({ title: 'T', body: BODY, priceXec: 100 })
    expect(res.ok).toBe(true)
    expect('storedBody' in res).toBe(false)
  })

  it('fresh draft INSERT defaults published:false', async () => {
    const { savePost } = await import('@/app/dashboard/savePost')
    const res = await savePost({
      nextPublished: false,
      isEditMode: false,
      title: 'T',
      body: BODY,
      priceXec: 100,
    })
    expect(res.ok).toBe(true)
    expect(db.state.lastInsertPayload.published).toBe(false)
  })
})
