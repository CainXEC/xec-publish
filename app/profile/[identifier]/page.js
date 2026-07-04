import { notFound } from 'next/navigation'
import AuthorProfilePageClient from '@/components/AuthorProfilePageClient'
import { resolveProfileByIdentifier } from '@/lib/resolveProfile'
import { hydrateAuthorProfile } from '@/lib/loadAuthorProfile'

// Reached via the next.config rewrite:  /@<identifier>  ->  /profile/<identifier>
// <identifier> is either a handle ("simon") or a bare eCash address ("qq703j…").

export async function generateMetadata({ params }) {
  const { identifier: raw } = await params
  const identifier = typeof raw === 'string' ? decodeURIComponent(raw.trim()) : ''
  const resolved = identifier ? await resolveProfileByIdentifier(identifier) : null
  const title = resolved ? `${resolved.identity} — proofofwriting` : 'Profile — proofofwriting'
  return {
    title,
    openGraph: { title, type: 'profile' },
  }
}

export default async function ProfilePage({ params }) {
  const { identifier: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }

  const identifier = decodeURIComponent(raw.trim())

  const resolved = await resolveProfileByIdentifier(identifier)
  if (!resolved) {
    notFound()
  }

  // A minted handle can be held by someone with no articles — or no account at
  // all. It still resolves; we just have no posts to hydrate in that case.
  const { error, posts, totalUnlocks, totalEarnings } = resolved.author
    ? await hydrateAuthorProfile(resolved.author)
    : { error: null, posts: [], totalUnlocks: 0, totalEarnings: 0 }

  // Byline = the account's LIVE identity: "@handle" if held, else the raw address.
  const isAddressIdentity = !resolved.identity.startsWith('@')

  return (
    <AuthorProfilePageClient
      author={resolved.author}
      displayName={resolved.identity}
      isAddressIdentity={isAddressIdentity}
      holderAddress={resolved.holderAddress}
      cardImageUrl={resolved.cardImageUrl}
      initialPosts={posts}
      totalUnlocks={totalUnlocks}
      totalEarnings={totalEarnings}
      postsErrorMessage={error || null}
    />
  )
}
