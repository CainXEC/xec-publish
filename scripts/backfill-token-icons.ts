// =============================================================================
//  backfill-token-icons.ts
//  Register the Cashtab token icon for handles minted BEFORE icon upload was
//  wired into the mint flow. For each handle it rasterizes the deterministic
//  card (seeded from token_id, same path the mint uses) and POSTs it to the
//  eCash token-server via submitTokenIcon().
//
//  Safe to re-run: the token-server rejects a second upload for an existing
//  tokenId, which submitTokenIcon treats as success — so already-iconed handles
//  are counted as "already registered", not errors. Icons are immutable, so this
//  only fills gaps; it can never overwrite art already on the server.
//
//  Dry-run by default (lists what it WOULD upload). Add --submit to actually POST.
//
//    node --env-file=.env.local --import tsx scripts/backfill-token-icons.ts
//    node --env-file=.env.local --import tsx scripts/backfill-token-icons.ts --submit
//    ...optional: --limit 25   (cap how many to process this run)
//
//  Needs in env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and one of
//  MINT_WALLET_SK / MINT_WALLET_MNEMONIC (to sign uploads).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { rasterizeHandleCard } from "../lib/hostHandleCard";
import { submitTokenIcon } from "../lib/submitTokenIcon";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const submit = process.argv.includes("--submit");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;

  const { data: rows, error } = await supabase
    .from("handles")
    .select("token_id, handle")
    .order("token_id", { ascending: true });
  if (error) {
    console.error("Failed to read handles:", error.message);
    process.exit(1);
  }

  const handles = (limit ? rows!.slice(0, limit) : rows!) ?? [];
  console.log(`${handles.length} handle(s) to process${submit ? "" : "  (DRY RUN — no uploads)"}\n`);

  let registered = 0;
  let failed = 0;
  for (const h of handles) {
    if (!submit) {
      console.log(`would submit  @${h.handle}  ${h.token_id}`);
      continue;
    }
    try {
      const png = rasterizeHandleCard(h.handle, h.token_id);
      const res = await submitTokenIcon(png, h.token_id, {
        name: h.handle,
        ticker: h.handle,
        url: `https://proofofwriting.com/@${h.handle}`,
      });
      if (res.ok) {
        registered++;
        console.log(`ok            @${h.handle}  ${h.token_id}`);
      } else {
        failed++;
        console.log(`FAILED        @${h.handle}  ${h.token_id}  — ${res.error}`);
      }
    } catch (e) {
      failed++;
      console.log(`FAILED        @${h.handle}  ${h.token_id}  — ${e instanceof Error ? e.message : e}`);
    }
  }

  if (submit) {
    console.log(`\nDone. registered/already-present: ${registered}, failed: ${failed}`);
  } else {
    console.log(`\nDRY RUN complete. Re-run with --submit to upload.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
