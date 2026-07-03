// =============================================================================
//  seed-reserved-handles.ts
//  Seeds reserved_handles (skeleton-folded) and runs the MIRROR CHECK:
//  flags any existing author whose FINAL handle collides with a reserved term.
//  Run with the Supabase SERVICE ROLE key. Idempotent (upsert on skeleton).
//
//    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx seed-reserved-handles.ts
//
//  Place next to handleSkeleton.ts (or fix the import path).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { skeleton, validateHandleSyntax } from "./handleSkeleton";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

// ---- the reserved list. EXTEND THIS before running on production. -----------
// Each entry is a literal handle string; the seeder folds it to a skeleton.
// Add your own founder/identity handles. Add leet variants of sensitive terms,
// since the relaxed confusable rule leaves them otherwise mintable.
const RESERVED: { reason: string; terms: string[] }[] = [
  { reason: "platform", terms: [
    "proofofwriting", "proof_of_writing", "pow", "powriting",
  ]},
  { reason: "project", terms: [
    "ecash", "xec", "cashtab", "chronik", "agora", "bitcoinabc", "avalanche", "ecashofficial",
  ]},
  { reason: "staff", terms: [
    "admin", "administrator", "root", "system", "sysadmin", "superuser",
    "mod", "moderator", "staff", "official", "team", "owner", "ceo", "founder",
    "support", "help", "helpdesk", "contact", "info", "billing",
    "payment", "payments", "security", "abuse", "legal", "dmca",
    "press", "media", "news", "announcement", "announcements", "blog",
    // leet / look-alike variants of the most-impersonated terms (extend freely):
    "4dmin", "adm1n", "4dm1n", "supp0rt", "0fficial", "m0d", "st4ff", "te4m", "0wner",
  ]},
  { reason: "generic", terms: [
    "everyone", "anonymous", "anon", "null", "undefined", "none",
    "test", "unknown", "deleted", "user",
  ]},
  // ---- ABUSE: profanity / slurs --------------------------------------------
  // DO NOT hand-maintain this. Load a vetted, maintained profanity/slur list and
  // spread it in here, e.g.:  ...require("./profanity-list.json")
  { reason: "abuse", terms: [] },
];

// ---- your 8 grandfather rewrites (original username -> final handle) ---------
// Embedded so the mirror check uses FINAL handles whether or not you've written
// these back to authors.username yet. (REWRITES[name] ?? name is rewrite-safe.)
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

async function main() {
  // 1. build the reserved rows, deduped by skeleton
  const bySkeleton = new Map<string, { handle_skeleton: string; handle: string; reason: string }>();
  const notMintable: string[] = [];
  for (const { reason, terms } of RESERVED) {
    for (const term of terms) {
      if (validateHandleSyntax(term)) { notMintable.push(term); continue; } // can't collide w/ a mintable name anyway
      const sk = skeleton(term);
      if (!bySkeleton.has(sk)) bySkeleton.set(sk, { handle_skeleton: sk, handle: term, reason });
    }
  }
  const rows = [...bySkeleton.values()];

  // 2. upsert (idempotent)
  const { error } = await supabase
    .from("reserved_handles")
    .upsert(rows, { onConflict: "handle_skeleton" });
  if (error) throw error;
  console.log(`Seeded ${rows.length} reserved skeletons (${RESERVED.reduce((n, r) => n + r.terms.length, 0)} terms in).`);
  if (notMintable.length) {
    console.log(`Skipped ${notMintable.length} term(s) that aren't valid handles (can't collide anyway): ${notMintable.join(", ")}`);
  }

  // 3. MIRROR CHECK — any author whose final handle hits a reserved skeleton
  const reservedSet = new Set(rows.map((r) => r.handle_skeleton));
  const authors = await fetchAllAuthors();
  const hits = authors
    .filter((a) => a.username)
    .map((a) => ({ a, fh: finalHandle(a.username), sk: skeleton(finalHandle(a.username)) }))
    .filter((x) => reservedSet.has(x.sk))
    .map((x) => ({ id: x.a.id, username: x.a.username, finalHandle: x.fh, reservedTerm: bySkeleton.get(x.sk)!.handle, reason: bySkeleton.get(x.sk)!.reason }));

  console.log("\n=== MIRROR CHECK (author final-handle vs reserved) ===");
  if (hits.length === 0) {
    console.log("No author collides with a reserved term. Clear to genesis.");
  } else {
    console.log("CONFLICTS — decide each: grandfather the person, or hold the term.\n");
    for (const h of hits) {
      console.log(`  "${h.finalHandle}" [${h.id}] collides with reserved "${h.reservedTerm}" (${h.reason})`);
    }
    console.log("\nResolve these before genesis.");
  }
  process.exit(hits.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
