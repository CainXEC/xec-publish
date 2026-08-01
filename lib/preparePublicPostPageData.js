import { splitPostBodyAtPaywall, hasLockedBodyContent } from '@/lib/splitPostBodyAtPaywall'
import { sanitizePostBodyHtml } from '@/lib/sanitizePostBodyHtml'
import { verifyPostReaderEntitlement } from '@/lib/verifyPostReaderEntitlement'

/**
 * Strip locked body from SSR props unless the request is entitled.
 * Returns props safe to pass into PostPageClient (no raw `body` field).
 */
export async function preparePublicPostPageData(data, cookieStore) {
  const { body, ...postWithoutBody } = data.post
  const entitled = await verifyPostReaderEntitlement(
    data.post.id,
    data.post.author_id,
    cookieStore,
  )
  const { bodyPublic, bodyLocked, hasPaywall } = splitPostBodyAtPaywall(body, {
    postId: data.post.id,
  })
  const fullBody =
    bodyLocked != null ? `${bodyPublic}${bodyLocked}` : bodyPublic
  const bodyHtml = sanitizePostBodyHtml(entitled ? fullBody : bodyPublic)

  return {
    initialPost: postWithoutBody,
    initialBodyHtml: bodyHtml,
    initialUnlocked: entitled,
    hasPaywallMarker: hasPaywall,
    // Whether the paywall actually hides writing. When false (no marker, or a
    // marker with nothing after it), unlocking only grants commenting — the
    // reader UI says so instead of promising "the rest of the story".
    hasLockedContent: hasLockedBodyContent(bodyLocked),
    initialAuthor: data.author,
    initialAuthorAccountId: data.authorAccountId ?? null,
    initialUnlockCount: data.unlockCount,
    initialCommentCount: data.commentCount,
  }
}
