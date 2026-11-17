'use client'

import { useMemo } from 'react'
import {
  useTweet,
  enrichTweet,
  TweetContainer,
  TweetHeader,
  TweetInReplyTo,
  TweetMedia,
  QuotedTweet,
  TweetInfo,
  TweetSkeleton,
} from 'react-tweet'
import { xPostUrl } from '@/lib/xLinks'
import { externalUrlHref } from '@/lib/contentLinks'

/**
 * An embedded X post — text, images, video, quoted post — for a feed post,
 * quote, reply, forum post/comment, or an article body (via ArticleProse).
 * Mirrors YouTubeEmbed: given an id it renders, given nothing it renders nothing.
 *
 * Drawn by US (react-tweet's pieces), not X's widget iframe/script: the post's
 * data comes from our own /api/x-post/<id> (server-fetched, markup-neutralized,
 * sensitive media withheld — lib/xPostData), so no X code runs on this origin.
 * Styled from the surrounding page's tokens (--panel/--line/--text/--cyan…),
 * so it follows the terminal (dark) and paper (light) themes automatically.
 *
 * Link policy: the post itself, its author, @mentions and #hashtags link to X
 * (an allowed external host). A URL INSIDE the post is live only if it points
 * at a whitelisted domain (EXTERNAL_LINK_DOMAINS — e.cash, cashtab.com, X);
 * any other site is shown but inert — same rule as everywhere else.
 */
export default function XEmbed({ id }) {
  const sid = String(id ?? '')
  if (!/^\d{1,20}$/.test(sid)) return null
  return (
    // Clicks inside the card belong to the card (links → X, video controls),
    // never to the feed row underneath, which would open the thread instead.
    // An iframe embed gets this for free; a drawn card has to ask for it.
    <div className="xembed not-prose" onClick={(e) => e.stopPropagation()}>
      <style href="pow-xembed" precedence="default">
        {X_EMBED_CSS}
      </style>
      <XEmbedLoader key={sid} id={sid} />
    </div>
  )
}

function XEmbedLoader({ id }) {
  const { data, error, isLoading } = useTweet(id, `/api/x-post/${id}`)
  if (isLoading) return <TweetSkeleton />
  if (error || !data) return <XFallback id={id} gone={error?.status === 404} />
  return <XPostCard data={data} />
}

function XPostCard({ data }) {
  const tweet = useMemo(() => enrichTweet(data), [data])
  return (
    <TweetContainer>
      <TweetHeader tweet={tweet} />
      {tweet.in_reply_to_status_id_str ? <TweetInReplyTo tweet={tweet} /> : null}
      <XPostBody tweet={tweet} />
      {tweet.mediaDetails?.length ? <TweetMedia tweet={tweet} /> : null}
      {tweet.pow_media_hidden ? (
        <a className="xembed-hidden" href={tweet.url} target="_blank" rel="noopener noreferrer nofollow">
          Sensitive media hidden · view on X ↗
        </a>
      ) : null}
      {tweet.quoted_tweet ? <QuotedTweet tweet={tweet.quoted_tweet} /> : null}
      <TweetInfo tweet={tweet} />
    </TweetContainer>
  )
}

// X sends text with &amp; / &lt; / &gt; escapes. Decode them to plain characters
// and let React render TEXT (react-tweet's own body uses innerHTML for this).
// One pass, so "&amp;lt;" correctly becomes "&lt;", not "<".
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }
function decode(s) {
  return String(s ?? '').replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m])
}

function XLink({ href, children }) {
  return (
    <a className="xembed-link" href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  )
}

function XPostBody({ tweet }) {
  return (
    <p className="xembed-text" lang={tweet.lang} dir="auto">
      {tweet.entities.map((item, i) => {
        switch (item.type) {
          case 'hashtag':
          case 'mention':
          case 'symbol':
            return (
              <XLink key={i} href={item.href}>
                {decode(item.text)}
              </XLink>
            )
          case 'url': {
            // An outbound link inside the post follows the site's whitelist:
            // e.cash / cashtab / X stay clickable, anything else is shown inert.
            const href = externalUrlHref(item.href)
            return href ? (
              <XLink key={i} href={href}>
                {decode(item.text)}
              </XLink>
            ) : (
              <span key={i} className="xembed-url">
                {decode(item.text)}
              </span>
            )
          }
          case 'media':
            return null // rendered as media below, never as text
          default:
            return <span key={i}>{decode(item.text)}</span>
        }
      })}
      {tweet.note_tweet ? (
        <>
          {' '}
          <XLink href={tweet.url}>Show more</XLink>
        </>
      ) : null}
    </p>
  )
}

function XFallback({ id, gone }) {
  return (
    <a className="xembed-fallback" href={xPostUrl(id)} target="_blank" rel="noopener noreferrer nofollow">
      <span aria-hidden className="xembed-mark">𝕏</span>
      <span>{gone ? 'This post is unavailable on X' : 'View this post on X'}</span>
      <span aria-hidden>↗</span>
    </a>
  )
}

// Hoisted + de-duplicated by React (style href/precedence), so a feed with ten
// embeds ships this once. Doubled class (.xembed.xembed) out-ranks the page's own
// link rules (.pow-feed a, .pow-article .prose a[href]) inside the card; the
// card's own link kinds add a class on top of that reset so they win in turn.
const X_EMBED_CSS = `
.xembed{margin:12px 0 0;max-width:550px;}
.xembed .react-tweet-theme{
  --tweet-container-margin:0;
  --tweet-font-family:inherit;
  --tweet-font-color:var(--text,#d6fff0);
  --tweet-font-color-secondary:var(--dim,#5f8a7e);
  --tweet-bg-color:var(--panel2,#0a110f);
  --tweet-bg-color-hover:var(--panel,#0d1513);
  --tweet-quoted-bg-color-hover:var(--panel,#0d1513);
  --tweet-border:1px solid var(--line,#173a33);
  --tweet-color-blue-primary:var(--cyan,#3df0ff);
  --tweet-color-blue-primary-hover:var(--cyan,#3df0ff);
  --tweet-color-blue-secondary:var(--cyan,#3df0ff);
  --tweet-color-blue-secondary-hover:transparent;
  --tweet-twitter-icon-color:var(--text,#d6fff0);
  --tweet-verified-old-color:var(--dim,#5f8a7e);
  --tweet-verified-blue-color:var(--cyan,#3df0ff);
  --tweet-skeleton-gradient:linear-gradient(270deg,var(--panel2,#0a110f),var(--panel,#0d1513),var(--panel,#0d1513),var(--panel2,#0a110f));
  --tweet-header-font-size:13.5px;--tweet-header-line-height:1.35;
  --tweet-body-font-size:14.5px;--tweet-body-line-height:1.55;
  --tweet-quoted-body-font-size:13.5px;--tweet-quoted-body-line-height:1.5;
  --tweet-info-font-size:12px;--tweet-info-line-height:1.3;
  min-width:0;max-width:none;
}
.xembed.xembed .react-tweet-theme a,.xembed.xembed .react-tweet-theme a[href]{
  color:inherit;text-decoration:none;text-shadow:none;}
.xembed.xembed .react-tweet-theme a[href]:hover{text-decoration:underline;text-shadow:none;}
.xembed.xembed .xembed-text{margin:6px 0 0;font-size:var(--tweet-body-font-size);
  line-height:var(--tweet-body-line-height);white-space:pre-wrap;overflow-wrap:anywhere;
  text-align:start;hyphens:manual;color:var(--tweet-font-color);}
.xembed.xembed .react-tweet-theme a.xembed-link[href]{color:var(--cyan,#3df0ff);}
.xembed .xembed-url{color:var(--dim,#5f8a7e);}
.xembed.xembed .react-tweet-theme a.xembed-hidden[href]{display:block;margin-top:10px;padding:14px;border:1px dashed var(--line,#173a33);
  border-radius:10px;font-size:12.5px;color:var(--dim,#5f8a7e);text-align:center;}
.xembed.xembed a.xembed-fallback{display:flex;align-items:center;gap:8px;padding:12px 14px;
  border:1px solid var(--line,#173a33);border-radius:12px;background:var(--panel2,#0a110f);
  font-size:13px;color:var(--dim,#5f8a7e);text-decoration:none;}
.xembed.xembed a.xembed-fallback:hover{color:var(--text,#d6fff0);}
.xembed .xembed-mark{font-weight:800;color:var(--text,#d6fff0);}
`
