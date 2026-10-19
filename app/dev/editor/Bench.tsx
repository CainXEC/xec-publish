"use client";

import { useState } from "react";
import RichTextEditor from "@/components/RichTextEditor";
import { sanitizePostBodyHtml } from "@/lib/sanitizePostBodyHtml";
import { ARTICLE_CSS } from "@/app/posts/[slug]/articleTheme";

const SAMPLE =
  "<p>An article with a table:</p>" +
  "<table><tbody>" +
  "<tr><th><p>Handle length</p></th><th><p>Tier</p></th><th><p>Price</p></th></tr>" +
  "<tr><td><p>1–5 characters</p></td><td><p>Short</p></td><td><p>1,000,000 XEC</p></td></tr>" +
  "<tr><td><p>6–10 characters</p></td><td><p>Mid</p></td><td><p>100,000 XEC</p></td></tr>" +
  "<tr><td><p>11–15 characters</p></td><td><p>Base</p></td><td><p>10,000 XEC</p></td></tr>" +
  "</tbody></table><p>Text after the table.</p>";

export default function Bench() {
  const [html, setHtml] = useState(SAMPLE);
  return (
    <div>
      <section style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
        <h2 id="dev-editor-label" style={{ fontWeight: 700, marginBottom: 8 }}>
          Editor
        </h2>
        <RichTextEditor
          content={SAMPLE}
          onChange={setHtml}
          id="dev-editor"
          ariaLabelledBy="dev-editor-label"
        />
      </section>
      {/* .pow-article is a full-bleed page scope (100vw, min-height 100vh), so it
          gets its own row below the editor; the column inside matches the post. */}
      <section className="pow-article">
        <style>{ARTICLE_CSS}</style>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
          <h2 style={{ fontWeight: 700 }}>Reader</h2>
          <div
            className="prose"
            dangerouslySetInnerHTML={{ __html: sanitizePostBodyHtml(html) }}
          />
          <pre
            data-testid="html"
            style={{
              marginTop: 16,
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              opacity: 0.6,
            }}
          >
            {html}
          </pre>
        </div>
      </section>
    </div>
  );
}
