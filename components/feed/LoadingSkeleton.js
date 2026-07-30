// =============================================================================
//  LoadingSkeleton.js — shared route-level loading skeletons.
//
//  Why this exists: the App Router shows NOTHING on a client-side navigation
//  until the destination's server render + RSC payload finish downloading. On
//  desktop that's a few hundred ms; on mobile (higher round-trip latency, and
//  the profile/thread render is a multi-query DB waterfall) it's 1–3s of the
//  OLD page frozen on screen with zero feedback — which reads as "slow". A
//  loading.js at a route boundary paints its skeleton INSTANTLY on tap (it
//  ships in the route bundle, no round trip), then streams the real page in.
//
//  Self-contained by necessity: loading UI renders BEFORE the client component
//  injects FEED_CSS, so we can't rely on the feed theme's --bg/--panel/--line
//  vars being defined. We redeclare the ~5 tokens we use, dark by default and
//  the paper palette under html:not(.dark), matching feedTheme's token set so
//  the skeleton themes correctly in both the terminal (dark) and manuscript
//  (light) modes. Shimmer respects prefers-reduced-motion.
// =============================================================================

export function SkeletonStyle() {
  return (
    <style>{`
      .pow-loading{
        --sk-bg:#070b0a; --sk-panel:#0d1513; --sk-line:#173a33; --sk-hi:rgba(214,255,240,.06);
        min-height:70vh; background:var(--sk-bg);
      }
      html:not(.dark) .pow-loading{
        --sk-bg:#f6f4ed; --sk-panel:#f1eee4; --sk-line:#e3dfd2; --sk-hi:rgba(26,28,23,.05);
      }
      .pow-loading .sk-wrap{max-width:640px;margin:0 auto;padding:24px 20px 56px;}
      .pow-loading .sk{
        background:var(--sk-panel); border-radius:8px; position:relative; overflow:hidden;
      }
      .pow-loading .sk::after{
        content:""; position:absolute; inset:0;
        background:linear-gradient(90deg,transparent,var(--sk-hi),transparent);
        transform:translateX(-100%); animation:sk-sweep 1.4s ease-in-out infinite;
      }
      @media (prefers-reduced-motion:reduce){
        .pow-loading .sk::after{animation:none;}
      }
      @keyframes sk-sweep{100%{transform:translateX(100%);}}
      .pow-loading .sk-row{display:flex;align-items:center;gap:12px;}
      .pow-loading .sk-card{
        border:1px solid var(--sk-line); border-radius:12px; padding:16px; margin-bottom:14px;
        background:transparent;
      }
      .pow-loading .sk-avatar{width:44px;height:44px;border-radius:50%;flex:0 0 auto;}
      .pow-loading .sk-line{height:12px;border-radius:6px;}
      .pow-loading .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);}
    `}</style>
  )
}

/** A stack of short lines approximating a paragraph / post body. */
export function SkeletonLines({ count = 3, widths = ['100%', '96%', '72%'] }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="sk sk-line"
          style={{ width: widths[i % widths.length], marginTop: i === 0 ? 0 : 10 }}
        />
      ))}
    </>
  )
}

/** One feed/post card skeleton: avatar + byline + a few body lines. */
export function SkeletonPostCard({ lines = 2 }) {
  return (
    <div className="sk-card">
      <div className="sk-row" style={{ marginBottom: 14 }}>
        <div className="sk sk-avatar" />
        <div style={{ flex: 1 }}>
          <div className="sk sk-line" style={{ width: '40%' }} />
          <div className="sk sk-line" style={{ width: '24%', height: 10, marginTop: 8 }} />
        </div>
      </div>
      <SkeletonLines count={lines} />
    </div>
  )
}
