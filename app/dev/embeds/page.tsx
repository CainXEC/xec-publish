// =============================================================================
//  app/dev/embeds/page.tsx  (DEV ONLY)
//  Media-embed bench: X post cards (and YouTube) exactly as the feed and an
//  article body render them — feed CSS + XEmbed, and an article run through the
//  REAL publish transform + read sanitizer + ArticleProse — so embeds can be
//  eyeballed in both themes without paying to post. Paste any X/YouTube URL to
//  try it. Returns 404 in production (same convention as /dev/cards).
// =============================================================================
import { notFound } from "next/navigation";
import { transformArticleBodyLinks } from "@/lib/articleBodyLinks";
import { sanitizePostBodyHtml } from "@/lib/sanitizePostBodyHtml";
import Bench from "./Bench";

export const metadata = { title: "embed bench" };

// A photo post, a video post, a text-only post, and an id that doesn't exist.
const SAMPLES = [
  "https://x.com/TheEllenShow/status/440322224407314432",
  "https://x.com/elonmusk/status/1585341984679469056",
  "https://twitter.com/jack/status/20",
  "https://x.com/nobody/status/1",
];

const ARTICLE =
  "<p>An article that quotes a post inline: as <strong>Ellen</strong> put it " +
  `${SAMPLES[0]} — and then carries on.</p>` +
  `<p>${SAMPLES[2]}</p>` +
  "<p>A YouTube link on its own line still embeds a player:</p>" +
  "<p>https://youtu.be/dQw4w9WgXcQ</p><p>The end.</p>";

export default function DevEmbedsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const articleHtml = sanitizePostBodyHtml(transformArticleBodyLinks(ARTICLE));
  return <Bench samples={SAMPLES} articleHtml={articleHtml} />;
}
