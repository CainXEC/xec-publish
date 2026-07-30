import { SkeletonStyle, SkeletonLines } from '@/components/feed/LoadingSkeleton'

// Shown instantly when opening an article (/posts/<slug>) — e.g. tapping an
// unlock/publish row in the "Live on POW" rail — while the server renders the
// post. Title + byline + reading column, matching the 760px article measure.
export default function ArticleLoading() {
  return (
    <div className="pow-loading">
      <SkeletonStyle />
      <div className="sk-wrap" style={{ maxWidth: 760, paddingTop: 40 }}>
        {/* title */}
        <div className="sk sk-line" style={{ width: '85%', height: 30 }} />
        <div className="sk sk-line" style={{ width: '55%', height: 30, marginTop: 12 }} />
        {/* byline */}
        <div className="sk-row" style={{ marginTop: 22, marginBottom: 34 }}>
          <div className="sk sk-avatar" style={{ width: 36, height: 36 }} />
          <div className="sk sk-line" style={{ width: 160, height: 12 }} />
        </div>
        {/* body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <SkeletonLines count={4} widths={['100%', '97%', '99%', '68%']} />
          <SkeletonLines count={4} widths={['96%', '100%', '92%', '80%']} />
          <SkeletonLines count={3} widths={['100%', '90%', '58%']} />
        </div>
        <span className="sr-only">Loading article…</span>
      </div>
    </div>
  )
}
