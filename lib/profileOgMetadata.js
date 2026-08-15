import { truncateAtWord } from '@/lib/truncateAtWord'

const defaultSiteUrl = 'https://www.proofofwriting.com'

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl
}

// Card-template version. OG URLs are CDN-cached as immutable, so bump this
// whenever the /api/og/profile template itself changes to re-render every card.
const OG_TEMPLATE_VERSION = '1'

// A raw eCash address is 42 base32 chars — far too long for the card's
// headline slot. A handle ("@cain") is never touched (≤16 chars by
// handleSkeleton's own limit); shorten only the un-prefixed address form,
// same 10-head/4-tail shape used for addresses everywhere else on the site.
function shortenIdentity(identity) {
  const s = typeof identity === 'string' ? identity : ''
  if (s.startsWith('@') || s.length <= 20) return s
  return `${s.slice(0, 10)}…${s.slice(-4)}`
}

export function buildProfileOgImageUrl({ identity, color, bio, followers }) {
  const ogImageUrl = new URL('/api/og/profile', getSiteUrl())
  ogImageUrl.searchParams.set('identity', shortenIdentity(identity))
  if (color) ogImageUrl.searchParams.set('color', color)
  if (bio) ogImageUrl.searchParams.set('bio', bio)
  if (followers > 0) ogImageUrl.searchParams.set('followers', String(followers))
  ogImageUrl.searchParams.set('v', OG_TEMPLATE_VERSION)
  return ogImageUrl.toString()
}

export function profileOpenGraphMetadata({ identity, color, bio, followers, pageUrl }) {
  const description = bio
    ? truncateAtWord(bio, 160)
    : `${identity} on Proof Of Writing.`
  const ogImageUrl = buildProfileOgImageUrl({ identity, color, bio, followers })

  return {
    title: `${identity} — proofofwriting`,
    description,
    openGraph: {
      title: identity,
      description,
      url: pageUrl,
      siteName: 'Proof Of Writing',
      images: [
        {
          url: ogImageUrl,
          width: 2400,
          height: 1260,
          alt: identity,
        },
      ],
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title: identity,
      description,
      images: [ogImageUrl],
    },
  }
}
