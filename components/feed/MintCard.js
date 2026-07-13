import Link from 'next/link'
import HandleCardImage from '@/components/HandleCardImage'

/**
 * Handle-mint card body: the deterministic NFT card image for a freshly minted
 * handle, linking to the @handle profile (the handle + tier are printed on the
 * card image itself). Shared by the feed (FeedPost) and the thread's focused
 * post so the image renders in both places; the reply/like/repost bar sits below.
 */
export default function MintCard({ post }) {
  const meta = post.card_meta ?? {}
  const handle = typeof meta.handle === 'string' ? meta.handle : ''
  const href = handle ? `/@${handle}` : null
  const alt = handle ? `@${handle} handle NFT card` : 'handle NFT card'
  if (!post.image_url) return null

  const Img = (
    <HandleCardImage
      className="mintcard-img"
      src={post.image_url}
      handle={handle || null}
      alt={alt}
      loading="lazy"
    />
  )
  return (
    <div className="mintcard">
      {href ? <Link href={href} className="mintcard-imglink">{Img}</Link> : Img}
    </div>
  )
}
