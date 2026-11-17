"use client";

import { useState } from "react";
import FeedBody from "@/components/feed/FeedBody";
import XEmbed from "@/components/feed/XEmbed";
import YouTubeEmbed from "@/components/feed/YouTubeEmbed";
import ArticleProse from "@/components/ArticleProse";
import { FEED_CSS } from "@/components/feed/feedTheme";
import { ARTICLE_CSS } from "@/app/posts/[slug]/articleTheme";
import { extractXPostId, stripXPostLink } from "@/lib/xLinks";
import { extractYouTubeId, stripYouTubeLink } from "@/lib/youtubeLinks";
import { priceFeedPost } from "@/lib/feedPricing";

// One feed-style row: the text with embedded links stripped, then the embeds —
// the same decisions FeedPost makes.
function Row({ content }: { content: string }) {
  const xId = extractXPostId(content);
  const ytId = extractYouTubeId(content);
  let text = ytId ? stripYouTubeLink(content) : content;
  if (xId) text = stripXPostLink(text);
  const priced = priceFeedPost(content, { action: "post" });
  return (
    <article style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ fontSize: 12, color: "var(--dim)" }}>
        {priced.ok ? `${priced.costXec} XEC` : ""}
        {priced.ok && priced.xEmbed ? " · 𝕏 +1,000" : ""}
        {priced.ok && priced.youtube ? " · 🎬 +1,000" : ""}
      </div>
      {text ? (
        <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
          <FeedBody text={text} />
        </p>
      ) : null}
      {ytId ? <YouTubeEmbed id={ytId} /> : null}
      {xId ? <XEmbed id={xId} /> : null}
    </article>
  );
}

export default function Bench({ samples, articleHtml }: { samples: string[]; articleHtml: string }) {
  const [draft, setDraft] = useState("");
  const [tried, setTried] = useState<string[]>([]);
  return (
    <div>
      <section className="pow-feed" style={{ minHeight: "auto" }}>
        <style>{FEED_CSS}</style>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
          <h2 style={{ fontWeight: 700 }}>Feed</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) setTried((t) => [draft.trim(), ...t]);
              setDraft("");
            }}
            style={{ display: "flex", gap: 8, margin: "10px 0" }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste a post with an X or YouTube link…"
              aria-label="Test post text"
              style={{ flex: 1, padding: 8, background: "var(--panel)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8 }}
            />
            <button type="submit" style={{ padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
              Try
            </button>
          </form>
          {[...tried, ...samples.map((s, i) => (i === 0 ? `Best photo ever, still. ${s}` : s))].map((c, i) => (
            <Row key={`${i}-${c}`} content={c} />
          ))}
        </div>
      </section>
      <section className="pow-article">
        <style>{ARTICLE_CSS}</style>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
          <h2 style={{ fontWeight: 700 }}>Article</h2>
          <ArticleProse html={articleHtml} />
        </div>
      </section>
    </div>
  );
}
