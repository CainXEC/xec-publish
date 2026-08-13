// =============================================================================
//  backfill-reading-time.ts
//  Recompute posts.reading_time_minutes for every post with the fixed
//  calculateReadingTimeMinutes (lib/calculateReadingTimeMinutes.ts). The old
//  version whitespace-split the body to count words — CJK scripts (Chinese,
//  Japanese, Korean) don't space-delimit words at all, so an entire CJK
//  article collapsed into ~1-2 "words" and floored to "1 min read" regardless
//  of actual length. The fix counts CJK characters separately at their own
//  reading speed; this backfill re-derives every existing post's stored value
//  from its current body so already-published articles pick up the fix
//  without needing a re-save.
//
//  Dry-run by default (prints what it WOULD change). Add --apply to write.
//
//    node --env-file=.env.local --import tsx scripts/backfill-reading-time.ts
//    node --env-file=.env.local --import tsx scripts/backfill-reading-time.ts --apply
//    ...optional: --limit 50
//
//  Needs in env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
//  SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { calculateReadingTimeMinutes } from "../lib/calculateReadingTimeMinutes";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const LIMIT = Number(arg("limit")) || Infinity;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: rows, error } = await supabase
    .from("posts")
    .select("id, slug, body, reading_time_minutes")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }

  const posts = (rows ?? []).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} · ${posts.length} post(s) to check\n`);

  let corrected = 0;
  let unchanged = 0;

  for (const p of posts) {
    const next = calculateReadingTimeMinutes(p.body ?? "");
    const stored = p.reading_time_minutes ?? null;
    if (next === stored) {
      unchanged += 1;
      continue;
    }
    corrected += 1;
    console.log(`  ✎  ${p.slug} — ${stored ?? "null"} → ${next} min`);
    if (APPLY) {
      const { error: upErr } = await supabase
        .from("posts")
        .update({ reading_time_minutes: next })
        .eq("id", p.id);
      if (upErr) console.log(`     ! update failed: ${upErr.message}`);
    }
  }

  console.log(`\n${APPLY ? "updated" : "would update"} ${corrected} · unchanged ${unchanged}`);
  if (!APPLY && corrected > 0) console.log("re-run with --apply to write these.");
}

main().then(() => process.exit(0));
