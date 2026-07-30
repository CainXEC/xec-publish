import {
  SkeletonStyle,
  SkeletonPostCard,
  SkeletonLines,
} from '@/components/feed/LoadingSkeleton'

// Shown instantly when opening a thread (/feed/<txid>) — e.g. tapping a "Live
// on POW" rail row on mobile — while the server fetches the thread and streams
// it in. Focused post + a couple of replies.
export default function ThreadLoading() {
  return (
    <div className="pow-loading">
      <SkeletonStyle />
      <div className="sk-wrap">
        {/* focused post */}
        <div className="sk-card" style={{ marginBottom: 20 }}>
          <div className="sk-row" style={{ marginBottom: 16 }}>
            <div className="sk sk-avatar" />
            <div style={{ flex: 1 }}>
              <div className="sk sk-line" style={{ width: '45%' }} />
              <div className="sk sk-line" style={{ width: '28%', height: 10, marginTop: 8 }} />
            </div>
          </div>
          <SkeletonLines count={4} widths={['100%', '98%', '90%', '60%']} />
        </div>
        {/* replies */}
        <SkeletonPostCard lines={2} />
        <SkeletonPostCard lines={2} />
        <span className="sr-only">Loading thread…</span>
      </div>
    </div>
  )
}
