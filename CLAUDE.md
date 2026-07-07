# CLAUDE.md — proofofwriting.com (xec-publish)

eCash-native pay-per-read publishing platform. Next.js App Router, Supabase,
Vercel, Chronik (eCash indexer), Cashtab wallet. Node 24, npm.

When working on anything eCash/transaction-level, load the skill docs first:
https://ecashskill.vercel.app/skills/SKILL.md
(references at https://ecashskill.vercel.app/skills/references)

## Auth (wallet-only — Supabase Auth is fully retired)
- HMAC-signed `pow_session` cookie (lib/session.ts), 90-day rolling.
- Login = 5.5 XEC challenge payment with server UUID nonce in OP_RETURN
  (replay protection). `auth_challenges` table: sweep-on-write, delete-on-use.
- Identity key is `authorId` everywhere — never `user.id`.
- No `auth.uid()` RLS policies remain. Pattern: service-role Supabase client
  + app-layer checks via `getAuthedAccount()` / `requireAuthorId()`
  (lib/authHelpers.ts). New tables: enable RLS, no policies, service-role only.
- RPCs use SECURITY DEFINER with `set search_path = public`.

## Handle NFT identity model (LOCKED)
- Earnings always follow the account (author_id) and its payout address —
  never the handle. Selling a handle NFT transfers only the display name.
- Byline = account's live display identity: current handle if held on the
  primary address, raw eCash address if not. Lazy Chronik verification via
  accounts.active_handle_token_id / display_handle / display_handle_checked_at.
- Profile routing (Choice A): /@handle → current on-chain holder → account
  → posts. No-handle accounts get /a/<address>. Legacy /u/[username] 301s in.
- GROUP genesis (rehearsal): 7c32a2aaf1248d6ee45e468e1dc707bf92e4a4feb379013712ae88729312cdfe
  (ticker POWH). Real launch = fresh mint wallet + new GROUP genesis.

## ecash-wallet gotchas (hard-won)
- `build()` requires explicit `sats: 546n` on EVERY token output, or it
  throws a misleading "Insufficient satoshis".
- Broadcast response: `{ success, broadcasted: [txid, ...] }`; child token
  id = LAST txid (genesis lands after the chained split).
- App env var is NEXT_PUBLIC_SUPABASE_URL (not SUPABASE_URL).
- Chronik REST routes need `export const runtime = 'nodejs'`.

## Gen 1 NFT art engine (in build)
- ASCII/text art: 64×32 grid, 1024×1024, DejaVuSansMono-Bold 26px.
- Architecture MIRRORS the voxel handle-card engine (lib/renderHandleCard.ts +
  lib/hostHandleCard.ts): the runtime EMITS SVG and rasterizes SVG→PNG via
  @resvg/resvg-js against a bundled font (loadSystemFonts:false), so the
  runtime output IS the reference — no pixel-matching a foreign rasterizer.
  Renderer: lib/nft-art/render.ts (renderAsciiCard / asciiCardTraits);
  rasterizer: lib/nft-art/hostAsciiCard.ts (rasterizeAsciiCard).
- The one font-dependent step — emoji glyph → silhouette mask — is frozen
  OFFLINE by art-lab/bake_masks.py at fixed sampling params, shipped as
  lib/nft-art/masks/library.json (1202 curated subjects @ 46×26). Fonts live
  in lib/nft-art/fonts/ (DejaVu 2.37, OFL). The approved-art rule: masks are
  frozen at exact sampling params (Alice rabbit = 🐰 @ 44×21); the runtime only
  fills + paints them, never re-samples. art-lab/approved/*.png are DESIGN
  references for the look, NOT byte oracles.
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
- Payment finality: Avalanche Pre-Consensus polling (finality.js, ~2–3s).
- OG images render at 2× (2400×1260); cache-bust with &v= params.
- jsdom pinned to 25.0.1 (isomorphic-dompurify).
