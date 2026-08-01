import {
  SkeletonStyle,
  SkeletonPostCard,
} from '@/components/feed/LoadingSkeleton'

// Shown instantly on navigation to /dashboard while the server runs the
// account's query waterfall and streams the page in. Without this the click
// felt dead for ~1s (no loading.js = nothing paints until the whole RSC
// render lands). Approximates the real layout — welcome row, stat tiles,
// tab row, post rows — so there's no jarring shift when the content arrives.
export default function DashboardLoading() {
  return (
    <div className="pow-loading">
      <SkeletonStyle />
      <div className="sk-wrap">
        {/* welcome row: greeting left, logout right */}
        <div
          className="sk-row"
          style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}
        >
          <div className="sk sk-line" style={{ width: 240, height: 24 }} />
          <div className="sk" style={{ width: 84, height: 32, borderRadius: 8 }} />
        </div>
        {/* stat tiles */}
        <div className="sk-row" style={{ gap: 12, marginBottom: 26 }}>
          <div className="sk" style={{ flex: 1, height: 64, borderRadius: 12 }} />
          <div className="sk" style={{ flex: 1, height: 64, borderRadius: 12 }} />
          <div className="sk" style={{ flex: 1, height: 64, borderRadius: 12 }} />
          <div className="sk" style={{ flex: 1, height: 64, borderRadius: 12 }} />
        </div>
        {/* tab row */}
        <div className="sk-row" style={{ gap: 20, marginBottom: 18 }}>
          <div className="sk sk-line" style={{ width: 70, height: 14 }} />
          <div className="sk sk-line" style={{ width: 70, height: 14 }} />
          <div className="sk sk-line" style={{ width: 70, height: 14 }} />
          <div className="sk sk-line" style={{ width: 70, height: 14 }} />
        </div>
        <SkeletonPostCard lines={2} />
        <SkeletonPostCard lines={2} />
        <SkeletonPostCard lines={2} />
        <span className="sr-only">Loading dashboard…</span>
      </div>
    </div>
  )
}
