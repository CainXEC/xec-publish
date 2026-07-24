# CLAUDE.md — proofofwriting.com (xec-publish)

eCash-native pay-per-read publishing platform. Next.js App Router, Supabase,
Vercel, Chronik (eCash indexer), Cashtab wallet. Node 24, npm.

When working on anything eCash/transaction-level, load the skill docs first:
https://ecashskill.vercel.app/skills/SKILL.md
(references at https://ecashskill.vercel.app/skills/references)

## Auth (wallet-only — Supabase Auth is fully retired)
- HMAC-signed `pow_session` cookie (lib/session.ts), 90-day rolling.
- Login = 6 XEC challenge payment with server UUID nonce in OP_RETURN
  (replay protection). `auth_challenges` table: sweep-on-write, delete-on-use.
- Identity key is `authorId` everywhere — never `user.id`.
- No `auth.uid()` RLS policies remain. Pattern: service-role Supabase client
  + app-layer checks via `getAuthedAccount()` / `requireAuthorId()`
  (lib/authHelpers.ts). New tables: enable RLS, no policies, service-role only.
- RPCs use SECURITY DEFINER with `set search_path = public`.
- Address change (/api/account/change-address + walletAuth
  startAddressChange/verifyAddressChange): challenge session REQUIRED + a 6
  XEC nonce payment FROM the new wallet (proof of keys — never a form field).
  RPC change_primary_address swaps account_addresses / authors.xec_address /
  feed_posts.payout_address in one transaction; the OLD address stays linked
  (non-primary) so its unlocks keep working and it can still log in (recovery).
  If the new wallet owns an EMPTY shell account (stray login), the RPC absorbs
  it (addresses re-pointed, shell deleted); accounts with activity hard-block.
  Identity (welcome/byline) always resolves from the DB primary, never the
  session cookie's address — the cookie can lag after a swap.

## Handle NFT identity model (LOCKED)
- Earnings always follow the account (author_id) and its payout address —
  never the handle. Selling a handle NFT transfers only the display name.
- Byline = account's live display identity: current handle if held on the
  primary address, raw eCash address if not. Lazy Chronik verification via
  accounts.active_handle_token_id / display_handle / display_handle_checked_at.
- Profile routing (Choice A): /@handle → current on-chain holder → account
  → posts. No-handle accounts get /a/<address>. Legacy /u/[username] 301s in.
- GROUP genesis (LIVE launch): 04311f17fe204e501a38b5c296381e4f4824f504337659127f21722c4bde42e0
  (name "POW Handles", ticker WRITE, 10k + baton kept). Mint wallet / MINT_PAYMENT_ADDRESS =
  ecash:qpw8gv2d7lahzfzsnakwefmfs6jhwex5zyfnejs2k6. Supersedes the rehearsal GROUP
  7c32a2aaf1248d6ee45e468e1dc707bf92e4a4feb379013712ae88729312cdfe (ticker POWH).

## ecash-wallet gotchas (hard-won)
- `build()` requires explicit `sats: 546n` on EVERY token output, or it
  throws a misleading "Insufficient satoshis".
- Broadcast response: `{ success, broadcasted: [txid, ...] }`; child token
  id = LAST txid (genesis lands after the chained split).
- App env var is NEXT_PUBLIC_SUPABASE_URL (not SUPABASE_URL).
- Chronik REST routes need `export const runtime = 'nodejs'`.

## POWR OP_RETURN protocol (lib/feedProtocol.js)
- ONE envelope for every on-chain action: feed (post/reply/quote/repost/like)
  + site actions that used to ride a bare UUID push (publish/unlock/auth/handle)
  + article comments (comment/comment_reply, OP_10/OP_11 — distinct from feed
  post/reply so they read as comments on chain). Layout: LOKAD(4) | OP_0 version
  | OP_N action | [targetTxid 32] | [contentHash 32] | [nonce 36]. targetTxid on
  reply/quote/repost/like/comment_reply; contentHash on
  post/reply/quote/publish/comment/comment_reply; nonce (ASCII UUID) on
  auth/handle. `op_return_raw` is the script WITHOUT the leading 0x6a — Cashtab
  re-adds OP_RETURN.
- Content hash = sha256 of the EXACT stored UTF-8 bytes = the "proof of writing".
  Backend NEVER trusts a client-sent hash; it recomputes over stored bytes and
  compares to the on-chain value.
- LOKAD is env-driven and MUST be NEXT_PUBLIC_ (browser encoder + server decoder
  read the SAME value, else silent verify mismatch). Default = launch "POWR"
  (504f5752); a test/staging env can opt back to "PROW" (50524f57) via
  NEXT_PUBLIC_POW_LOKAD_HEX=50524f57 to avoid polluting the real index. The byte
  spec is frozen — it's permanent (docs/cashtab-powr-integration.md).

## Gen 1 NFT art engine (built + wired)
- Architecture MIRRORS the voxel handle-card engine (lib/renderHandleCard.ts +
  lib/hostHandleCard.ts): the runtime EMITS SVG and rasterizes SVG→PNG via
  @resvg/resvg-js against bundled fonts (loadSystemFonts:false), so the runtime
  output IS the reference — no pixel-matching a foreign rasterizer. Renderer:
  lib/nft-art/render.ts (renderAsciiCard / asciiCardTraits); rasterizer:
  lib/nft-art/hostAsciiCard.ts (rasterizeAsciiCard). Node-only (reads JSON off
  disk); wired into mint via lib/mintProcessor.ts → hostAsciiCard, seed = mint
  txid. Client reveal fallback = app/api/handle-card/[tokenId]/route.ts.
- THE TIER IS THE COLLECTIBLE. Which of 3 engines renders is a PURE FUNCTION of
  the handle via priceForHandle(handle).tier (lib/handlePricing.ts) — nothing is
  threaded through the DB/mint pipeline. Color rolls FIRST in every branch (5
  colors) so effective size = variants × 5:
  - short (1–5 chars, 1M XEC)   → kaomoji face  (lib/nft-art/kaomoji.ts, ~378).
  - mid   (6–10 chars, 100K XEC)→ ASCII scene: subject over starfield/planets
    (lib/nft-art/subjects.json, 2199 subjects scraped from asciiart.eu).
  - base  (11–15 chars, 10K XEC)→ ASCII silhouette mask from the 3-source
    library (1920 masks × 5 colors = 9,600 effective).
- White-ground variant (short tier only): ~10% of kaomoji cards invert to
  ink-on-paper (PAPER_WHITE #f4efe3). Rolled r()<0.10 INSIDE the short branch
  AFTER the color roll, so mid/base roll order is untouched; asciiCardTraits
  mirrors the roll + exposes background: "charcoal" | "paper".
- The one font-dependent step — glyph → silhouette mask — is frozen OFFLINE by
  art-lab/bake_icons.py (supersedes bake_masks.py for the library; bake_masks.py
  kept for rares) at fixed 46×26 sampling params, shipped as
  lib/nft-art/masks/library.json. 3 permissive sources, prefixed keys so sets
  never collide: emoji 821 unprefixed (NotoEmoji, OFL) + Tabler filled 402 "ti-"
  (MIT) + Material Symbols filled 697 "ms-" (Apache-2.0, FILL=1 instanced). The
  emoji masks reproduce BYTE-IDENTICAL to the old emoji-only bake (freeze
  intact). Fonts live in lib/nft-art/fonts/ (DejaVu 2.37 + unifont for exotic
  kaomoji) + art-lab/*.ttf (committed for provenance). The approved-art rule:
  masks are frozen at exact sampling params (Alice rabbit = 🐰 @ 44×21); the
  runtime only fills + paints them, never re-samples.
- BUNDLING GOTCHA: runtime JSON/font assets load via
  fileURLToPath(new URL("./x", import.meta.url)), NOT __dirname — only that
  pattern makes Next's file tracer bundle them into the serverless fn.
- Dev bench: /dev/cards (app/api/dev-card, 404 in prod) eyeballs all 3 tiers by
  handle without minting.
- Rares: not yet built. Drop pinned per-piece params in art-lab/rares.json
  (each pins its own max_cols/max_rows) and the bake emits masks/rares.json;
  it refuses to invent frozen params. 100 rares (70 Gold + 30 First Lines) via
  pre-committed slot map — slotmap.json SERVER-SIDE SECRET, only its SHA256
  commitment public until sellout. (Slotmap/mint-counter = mint-side, TBD.)
- Determinism: renderAsciiCard is seeded ONLY by the mint txid (blind reveal),
  RNG = sfc32(xmur3(txid)) — same contract as the voxel engine. The broader
  (txid, serial, nonce) + combo_hash UNIQUE re-roll design is mint-side (TBD).
- 10,000 hard cap, auto-pause at sellout (nft_mint_counter).

## Platform conventions
- Platform fee 6% (author receives 94%). Platform address:
  ecash:qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3
- Paywall: locked content must NEVER reach the client
  (splitPostBodyAtPaywall / verifyPostReaderEntitlement on the server).
- Search (sql/search.sql): posts.search_tsv is a GENERATED column that splits
  body at the paywall marker IN THE SCHEMA (post_public_search_text) — locked
  text is physically never indexed, so search can't become a paywall oracle.
  ts_headline snippets run over the same function. Same trust boundary as the
  paywall split; proven hermetically by tests/integration/searchDb.test.js.
- Payment finality: Avalanche Pre-Consensus polling (finality.js, ~2–3s).
- OG images render at 2× (2400×1260); cache-bust with &v= params.
- jsdom pinned to 25.0.1 (isomorphic-dompurify).

## House AI agents (SEPARATE repo — a deployed client, not a demo)
Three house accounts post and pay on this site as ordinary users. The client
that drives them lives at `/Users/cain/ai-satoshi`
(github.com/CainXEC/ai-satoshi, PRIVATE) — see its CLAUDE.md. They run on
GitHub Actions cron, so breaking any of the surfaces below fails SILENTLY here.
- AI_SATOSHI (author, publishes commissioned essays + engages), POW_AGENT0
  (patron, parked), POW_AGENT1 (herald/curator, runs contests).
- Surfaces built FOR them: `/api/agent/article` + `/api/agent/article/publish`
  (REST twins of the Server Action path, which an external client can't call);
  `/admin/agent` review queue + commission box; `authors.is_ai` ([AI] byline,
  labeled OG via `ai=1`); the `agent_worker` role, whose RLS policies are the
  ONE exception to this repo's service-role-only rule.
- is_ai accounts are excluded from RANKING signals (feed breadth + amount in
  sql/feed_engagement_signal.sql; reader counts in sql/rpc_get_unlock_counts.sql)
  but NOT from earnings (rpc_get_unlock_earnings) — a house agent's like or
  unlock pays the author for real, it just can't buy them rank.
