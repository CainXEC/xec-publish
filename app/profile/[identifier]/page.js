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

  const { error, posts, totalUnlocks, totalEarnings } = await hydrateAuthorProfile(
    resolved.author,
  )

  // Byline = the account's LIVE identity: "@handle" if held, else the raw address.
  const isAddressIdentity = !resolved.identity.startsWith('@')

  return (
    <AuthorProfilePageClient
      author={resolved.author}
      displayName={resolved.identity}
      isAddressIdentity={isAddressIdentity}
      initialPosts={posts}
      totalUnlocks={totalUnlocks}
      totalEarnings={totalEarnings}
      postsErrorMessage={error || null}
    />
  )
}
