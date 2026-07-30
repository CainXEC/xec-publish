import {
  SkeletonStyle,
  SkeletonPostCard,
} from '@/components/feed/LoadingSkeleton'

// Shown instantly on navigation to /@<handle> while the server resolves the
// profile (a multi-query DB waterfall) and streams the page in. Approximates
// the real layout — centered byline, handle-card strip, tab row, post cards —
// so there's no jarring shift when the content lands.
export default function ProfileLoading() {
  return (
    <div className="pow-loading">
      <SkeletonStyle />
      <div className="sk-wrap">
        {/* byline + follow row */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            className="sk sk-line"
            style={{ width: 200, height: 22, margin: '0 auto 12px' }}
          />
          <div
            className="sk sk-line"
            style={{ width: 120, height: 12, margin: '0 auto' }}
          />
        </div>
        {/* handle-card strip */}
        <div className="sk-row" style={{ justifyContent: 'center', gap: 12, marginBottom: 26 }}>
          <div className="sk" style={{ width: 96, height: 128, borderRadius: 12 }} />
          <div className="sk" style={{ width: 96, height: 128, borderRadius: 12 }} />
        </div>
        {/* tab row */}
        <div className="sk-row" style={{ gap: 20, marginBottom: 18 }}>
          <div className="sk sk-line" style={{ width: 70, height: 14 }} />
          <div className="sk sk-line" style={{ width: 70, height: 14 }} />
          <div className="sk sk-line" style={{ width: 70, height: 14 }} />
        </div>
        <SkeletonPostCard lines={2} />
        <SkeletonPostCard lines={3} />
        <SkeletonPostCard lines={2} />
        <span className="sr-only">Loading profile…</span>
      </div>
    </div>
  )
}
