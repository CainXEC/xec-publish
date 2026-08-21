'use client'

/**
 * An embedded YouTube player for a top-level feed / forum post (never comments —
 * the caller gates that). Privacy-enhanced host (youtube-nocookie.com, no cookies
 * until play), lazy-loaded, responsive 16:9. Given a video id it renders; given
 * nothing it renders nothing.
 */
export default function YouTubeEmbed({ id }) {
  if (!id) return null
  return (
    <div className="ytembed">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`}
        title="YouTube video player"
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  )
}
