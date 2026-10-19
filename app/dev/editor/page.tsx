// =============================================================================
//  app/dev/editor/page.tsx  (DEV ONLY)
//  Article editor bench: the real RichTextEditor next to a live reader preview
//  (same sanitizer + article CSS as the post page), so editor features like
//  tables can be checked without logging in. Returns 404 in production (same
//  convention as /dev/cards and /dev/wordmark).
// =============================================================================
import { notFound } from "next/navigation";
import Bench from "./Bench";

export const metadata = { title: "article editor bench" };

export default function DevEditorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Bench />;
}
