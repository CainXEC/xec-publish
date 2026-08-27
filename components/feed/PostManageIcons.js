'use client'
// =============================================================================
//  PostManageIcons.js — the author's own-post controls (Pin / Delete) as icon
//  buttons, sized to match the copy-link icon. Shared by the feed row (FeedPost)
//  and the thread view (FeedThreadClient) so the two can't drift. Lives inside a
//  `.postactions` cluster, whose CSS (feedTheme.js) sizes these to 26x22 and
//  colors them: the pin lights up red (--no) when pinned, delete goes red on
//  hover.
// =============================================================================

export default function PostManageIcons({ pinned, pinBusy, onPin, deleting, onDelete }) {
  return (
    <>
      <button
        type="button"
        onClick={onPin}
        disabled={pinBusy}
        className={`pinbtn${pinned ? ' on' : ''}`}
        aria-label={pinned ? 'Unpin post' : 'Pin post'}
        aria-pressed={pinned}
        title={pinned ? 'Unpin' : 'Pin'}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="delbtn"
        aria-label="Delete post"
        title="Delete"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </>
  )
}
