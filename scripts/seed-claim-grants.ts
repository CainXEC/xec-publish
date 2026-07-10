// =============================================================================
//  seed-claim-grants.ts
//  Grandfather seeder. For every legacy author WITH posts, reserves their final
//  handle for claiming and issues a one-time claim code:
//    - derives the final handle (username, or its approved REWRITE)
//    - stores a claim_grants row: handle, handle_skeleton, original_username,
//      legacy_author_ref = authors.id, code_hash (sha256), status "unclaimed"
//    - prints (username -> handle -> CODE) and writes claim-codes.csv
//
//  Only the HASH is stored server-side; the plaintext code exists once, in the
//  console + CSV you keep offline and distribute privately. That plus proof of
//  key-control (the dust tx in claimGrant.ts) is the whole claim security model.
//
//  DEFAULTS TO DRY-RUN. Pass --commit to actually write rows + the CSV.
//
//    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx seed-claim-grants.ts            # preview
//    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx seed-claim-grants.ts --commit   # write
//
//  Idempotent: an author whose handle already has a grant is left untouched (its
//  already-distributed code is NOT rotated). Re-running only seeds new authors.
//  Place next to handleSkeleton.ts (same location as seed-reserved-handles.ts).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { skeleton, validateHandleSyntax } from "./handleSkeleton";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

const COMMIT = process.argv.includes("--commit");

// Only grant to authors who have PUBLISHED at least one post. Flip to false to
// count any post (including drafts).
const PUBLISHED_ONLY = true;

// ---- the 8 approved grandfather rewrites (original username -> final handle) --
// Kept identical to seed-reserved-handles.ts.
const REWRITES: Record<string, string> = {
  "E-M81": "E_M81",
  "ISABELO.XEC": "ISABELO_XEC",
  "Last-Ink": "Last_Ink",
  "Mr. eCash": "Mr_eCash",
  "mugiwara luffy": "MugiwaraLuffy",
  "Elon Musk": "ElonMusk",
  "The Silent Cartographer": "TheSilentCartographer",
  "Amor fati": "AmorFati",
};
const finalHandle = (username: string) => REWRITES[username] ?? username;

// ---- one-time code: 16 chars, unambiguous alphabet (no I/O/0/1), no dashes. ---
// codeMatches() in claimGrant.ts compares sha256(code.trim()); it does NOT strip
// case or punctuation, so the code the author types must match EXACTLY. Keeping
// it uppercase + alnum makes that painless. ~80 bits of entropy.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string {
  const bytes = randomBytes(16);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function fetchAllAuthors() {
  const pageSize = 1000;
  const all: { id: string; username: string }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("authors").select("id, username")
      .order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as any));
    if (data.length < pageSize) break;
  }
  return all;
}

/** author_ids that have at least one (published) post. */
async function fetchAuthorIdsWithPosts(): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from("posts").select("author_id").order("author_id", { ascending: true }).range(from, from + pageSize - 1);
    if (PUBLISHED_ONLY) q = q.eq("published", true);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as any) if (r.author_id) ids.add(r.author_id);
    if (data.length < pageSize) break;
  }
  return ids;
}

async function fetchSkeletonSet(table: string): Promise<Set<string>> {
  const out = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select("handle_skeleton").range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as any) if (r.handle_skeleton) out.add(r.handle_skeleton);
    if (data.length < pageSize) break;
  }
  return out;
}

type Plan = {
  seed: { id: string; username: string; handle: string; sk: string; code: string }[];
  invalid: { username: string; handle: string }[];
  reserved: { username: string; handle: string }[];
  alreadyMinted: { username: string; handle: string }[];
  alreadyGranted: { username: string; handle: string }[];
  collision: { username: string; handle: string; sk: string }[];
};

async function main() {
  const [authors, withPosts, reservedSet, mintedSet, grantSet] = await Promise.all([
    fetchAllAuthors(),
    fetchAuthorIdsWithPosts(),
    fetchSkeletonSet("reserved_handles"),
    fetchSkeletonSet("handles"),
    fetchSkeletonSet("claim_grants"),
  ]);

  const eligible = authors.filter((a) => a.username && withPosts.has(a.id));

  const plan: Plan = { seed: [], invalid: [], reserved: [], alreadyMinted: [], alreadyGranted: [], collision: [] };
  const seenSkeleton = new Map<string, string>(); // sk -> username (intra-run collision detection)

  for (const a of eligible) {
    const handle = finalHandle(a.username);

    if (validateHandleSyntax(handle)) { plan.invalid.push({ username: a.username, handle }); continue; }
    const sk = skeleton(handle);

    if (reservedSet.has(sk)) { plan.reserved.push({ username: a.username, handle }); continue; }
    if (mintedSet.has(sk)) { plan.alreadyMinted.push({ username: a.username, handle }); continue; }
    if (grantSet.has(sk)) { plan.alreadyGranted.push({ username: a.username, handle }); continue; }

    const prior = seenSkeleton.get(sk);
    if (prior) { plan.collision.push({ username: a.username, handle, sk }); continue; }
    seenSkeleton.set(sk, a.username);

    plan.seed.push({ id: a.id, username: a.username, handle, sk, code: genCode() });
  }

  // ---- report ----
  console.log(`\nEligible authors (with ${PUBLISHED_ONLY ? "published " : ""}posts): ${eligible.length}`);
  console.log(`  to seed:         ${plan.seed.length}`);
  console.log(`  already granted: ${plan.alreadyGranted.length}`);
  console.log(`  already minted:  ${plan.alreadyMinted.length}`);
  console.log(`  reserved clash:  ${plan.reserved.length}`);
  console.log(`  invalid handle:  ${plan.invalid.length}`);
  console.log(`  intra-run clash: ${plan.collision.length}`);

  const dump = (label: string, rows: { username: string; handle: string }[]) => {
    if (!rows.length) return;
    console.log(`\n--- ${label} (need manual handling) ---`);
    for (const r of rows) console.log(`  "${r.username}"  ->  "${r.handle}"`);
  };
  dump("INVALID HANDLE", plan.invalid);
  dump("RESERVED CLASH", plan.reserved);
  dump("INTRA-RUN COLLISION", plan.collision);

  if (plan.seed.length) {
    console.log(`\n=== CLAIM CODES ${COMMIT ? "(committing)" : "(dry-run preview)"} ===`);
    console.log("username\thandle\tcode");
    for (const s of plan.seed) console.log(`${s.username}\t${s.handle}\t${s.code}`);
  }

  if (!COMMIT) {
    console.log(`\nDRY-RUN. No rows written, no CSV. Re-run with --commit to seed ${plan.seed.length} grant(s).`);
    process.exit(plan.invalid.length || plan.reserved.length || plan.collision.length ? 1 : 0);
  }

  // ---- commit ----
  if (plan.seed.length === 0) { console.log("\nNothing new to seed."); process.exit(0); }

  const rows = plan.seed.map((s) => ({
    handle: s.handle,
    handle_skeleton: s.sk,
    original_username: s.username,
    legacy_author_ref: s.id,        // contract: bindAuthorAccount reads this as authors.id
    code_hash: sha256(s.code),
    status: "unclaimed",
  }));

  // claim_grants.handle_skeleton is a FK into reserved_handles — a name must be
  // reserved before it can be granted. Reserve each grandfather handle first
  // (reason 'grandfather'; idempotent on skeleton), which also blocks a public
  // mint of that name until its owner claims it. Then insert the grants.
  const reservedRows = plan.seed.map((s) => ({
    handle_skeleton: s.sk, handle: s.handle, reason: "grandfather",
  }));
  const { error: resErr } = await supabase
    .from("reserved_handles")
    .upsert(reservedRows, { onConflict: "handle_skeleton" });
  if (resErr) { console.error("\nReserve failed:", resErr.message); process.exit(1); }

  const { error } = await supabase.from("claim_grants").insert(rows);
  if (error) { console.error("\nInsert failed:", error.message); process.exit(1); }

  const csv =
    "username,handle,legacy_author_ref,code\n" +
    plan.seed.map((s) => `${JSON.stringify(s.username)},${s.handle},${s.id},${s.code}`).join("\n") + "\n";
  writeFileSync("claim-codes.csv", csv);

  console.log(`\nSeeded ${rows.length} grant(s). Wrote claim-codes.csv (KEEP OFFLINE — plaintext codes).`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
