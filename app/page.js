import FeedClient from '@/components/feed/FeedClient'
import { getCachedForYouPage, FORYOU_PAGE_SIZE } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { isBrandNewUnfunded, accountProfilePath } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'

export default async function HomePage({ searchParams }) {
  let posts = []
  let nextCursor = null
  let loadError = null

  const params = await searchParams
  const initialCompose =
    typeof params?.share === 'string' ? params.share.slice(0, 280) : ''
  // `?compose=1` (from the dashboard "Write New Post" button) opens the feed with
  // the compose box focused, ready to write — no pre-filled content.
  const focusCompose = params?.compose === '1'
  // `?tab=forums` opens straight to the Forums directory (e.g. the "← Forums"
  // back link from a forum page), instead of the default Feed tab.
  const initialScope = params?.tab === 'forums' ? 'forums' : 'foryou'

  // Auth is read for page chrome (dashboard link), for the client-side
  // personalization/own-post logic, and to drop this viewer's blocked accounts
  // out of the feed server-side (see getCachedForYouPage) — everything else
  // per-viewer (your likes/reposts/follows) still layers on the client via
  // /api/feed/viewer-state; only blocks need to be gone before the FIRST paint,
  // or they'd flash on screen for a moment before that client effect resolves.
  //
  // Not awaited here: the feed's cached window doesn't need the session at all,
  // so starting both round trips together (instead of session-then-feed) cuts
  // one full wait off nearly every load. getCachedForYouPage takes a promise for
  // its viewer id and awaits it only once the feed side is ready to use it.
  const acctPromise = getAuthedAccount()

  // Onboarding: is this a brand-new, unfunded account (no tip received, no post,
  // no reaction) that should see the "Claim starter XEC" card? Chained off the
  // session so its cheap existence checks overlap the feed render below instead
  // of adding a serial round-trip. Logged-out / funded accounts resolve false.
  const starterPromise = acctPromise.then((a) =>
    a?.accountId ? isBrandNewUnfunded(a.accountId) : false,
  )

  try {
    const result = await getCachedForYouPage(
      null,
      FORYOU_PAGE_SIZE,
      acctPromise.then((a) => a?.accountId ?? null),
    )
    posts = result.posts
    nextCursor = result.nextCursor
  } catch (err) {
    loadError = err?.message || 'Failed to load feed'
  }

  const acct = await acctPromise
  const starterEligible = await starterPromise
  const profilePath = acct ? accountProfilePath(acct) : null

  return (
    <FeedClient
      initialPosts={posts}
      initialNextCursor={nextCursor}
      initialLoadError={loadError}
      viewerAccountId={acct?.accountId ?? null}
      isAuthor={acct?.authorId != null}
      initialCompose={initialCompose}
      focusCompose={focusCompose}
      initialScope={initialScope}
      starterEligible={starterEligible}
      profilePath={profilePath}
    />
  )
}
