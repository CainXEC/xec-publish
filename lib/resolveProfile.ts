// =============================================================================
//  resolveProfile.ts
//  Turn a single URL identifier (the thing after "@") into an author + display
//  identity, for the unified /@<identifier> profile page.
//
//  The identifier is EITHER:
//    • a handle   ("simon")                 -> resolve via the NFT + account
//    • an eCash address ("qq703j…")         -> resolve via account or author
//
//  Resolution chain (handle) — driven by ON-CHAIN OWNERSHIP, not by any login:
//    handles.handle_skeleton
//      -> handles.token_id (+ handle, image_url)
//      -> current on-chain holder of that NFT   (Chronik)
//      -> that holder's author, if any          (account.author_id, else
//         authors.xec_address)                  -> their posts
//  A handle ALWAYS resolves once minted: a holder with no articles — or no
//  proofofwriting account at all, e.g. a fresh paid mint that never logged in —
//  still gets a profile showing just the handle and its card. The display byline
//  is the handle from the URL.
//
//  Resolution chain (address):
//    account_addresses.address -> accounts.author_id -> authors row
//    (fallback) authors.xec_address -> authors row
//  with the display byline = the account's current display_handle if it has one,
//  else the raw address.
//
//  Chronik holder lookup is authoritative for the handle path but BEST-EFFORT:
//  if Chronik is unavailable we fall back to the account currently bound to the
//  token (accounts.active_handle_token_id) so profiles still resolve during an
//  outage.
// =============================================================================

import { createServerSupabase } from "@/lib/supabase-server";
import { skeleton } from "@/lib/handleSkeleton";
import { ChronikClient } from "chronik-client";
import { encodeCashAddress, decodeCashAddress } from "ecashaddrjs";

const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

// How stale the cached holder check may be before we re-verify on-chain.
const HOLDER_TTL_MS = 5 * 60_000;

export type Author = {
  id: string;
  username: string | null;
  bio: string | null;
  xec_address: string | null;
};

export type ResolvedProfile = {
  kind: "handle" | "address";
  /** The author whose posts to show, or null for a handle held by someone with
   *  no articles / no proofofwriting account (a handle-only profile). */
  author: Author | null;
  /** The current handle to show as the byline, or null if the account holds none. */
  displayHandle: string | null;
  /** What to render as the identity: "@handle" if held, else the raw address. */
  identity: string;
  tokenId: string | null;
  /** Current on-chain holder (handle path) or the address itself (address path).
   *  Shown on handle-only profiles that have no author record. */
  holderAddress: string | null;
  /** Public URL of the handle's NFT card, when known (handle path). */
  cardImageUrl: string | null;
};

// ---------------------------------------------------------------------------
//  identifier classification
// ---------------------------------------------------------------------------

/** If `raw` is a valid eCash address (with or without the ecash: prefix),
 *  return it normalized as a bare (prefixless), lowercase address; else null.
 *
 *  Note: we do NOT re-encode. In this ecashaddrjs version decodeCashAddress
 *  returns `hash` as a hex string while encodeCashAddress expects bytes, so a
 *  round-trip throws. decodeCashAddress succeeding is a sufficient validity
 *  check on its own; we then just lowercase and strip the prefix. */
export function normalizeAddress(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const candidate = trimmed.includes(":") ? trimmed : `ecash:${trimmed}`;
  try {
    const decoded = decodeCashAddress(candidate) as any;
    if (!decoded || decoded.prefix !== "ecash") return null;
    const lower = candidate.toLowerCase();
    return lower.startsWith("ecash:") ? lower.slice("ecash:".length) : lower;
  } catch {
    return null;
  }
}

/** Both stored forms of an address, so DB lookups match regardless of whether
 *  the column keeps the "ecash:" prefix. */
function addressForms(bare: string): string[] {
  return [bare, `ecash:${bare}`];
}

// ---------------------------------------------------------------------------
//  small DB helpers
// ---------------------------------------------------------------------------

async function authorById(id: string): Promise<Author | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("authors")
    .select("id, username, bio, xec_address")
    .eq("id", id)
    .maybeSingle();
  return (data as Author) ?? null;
}

/** The author to attribute to a wallet address: a linked account's author, or a
 *  legacy author whose xec_address is this wallet. Null if neither — a wallet can
 *  hold a handle without ever having written a post or created an account. */
async function authorForAddress(addressRaw: string): Promise<Author | null> {
  const bare = normalizeAddress(addressRaw);
  if (!bare) return null;
  const supabase = createServerSupabase();
  const forms = addressForms(bare);

  // 1) via a linked account -> its author
  const { data: links } = await supabase
    .from("account_addresses")
    .select("account_id")
    .in("address", forms)
    .limit(1);
  const accountId = links?.[0]?.account_id;
  if (accountId) {
    const { data: account } = await supabase
      .from("accounts")
      .select("author_id")
      .eq("id", accountId)
      .maybeSingle();
    if (account?.author_id) {
      const a = await authorById(account.author_id);
      if (a) return a;
    }
  }

  // 2) fallback: legacy author whose wallet this is
  const { data: authors } = await supabase
    .from("authors")
    .select("id, username, bio, xec_address")
    .in("xec_address", forms)
    .limit(1);
  return (authors?.[0] as Author) ?? null;
}

// ---------------------------------------------------------------------------
//  Chronik: current holder of an NFT1-child token (supply 1 -> one UTXO)
//  BEST-EFFORT. Verify the tokenId(...).utxos() shape against the installed
//  chronik-client version before relying on this for correctness.
// ---------------------------------------------------------------------------

function scriptToAddress(outputScriptHex: string): string | null {
  const s = String(outputScriptHex).toLowerCase();
  if (s.startsWith("76a914") && s.endsWith("88ac") && s.length === 50) {
    return encodeCashAddress("ecash", "p2pkh", s.slice(6, 46));
  }
  if (s.startsWith("a914") && s.endsWith("87") && s.length === 46) {
    return encodeCashAddress("ecash", "p2sh", s.slice(4, 44));
  }
  return null;
}

async function currentTokenHolder(tokenId: string): Promise<string | null> {
  try {
    const res: any = await chronik().tokenId(tokenId).utxos();
    const utxos: any[] = res?.utxos ?? [];
    // An NFT1 child has supply 1: exactly one live UTXO carries it.
    for (const u of utxos) {
      const script = u?.script ?? u?.outputScript;
      if (!script) continue;
      const addr = scriptToAddress(script);
      if (addr) return addr; // bare "ecash:..." form
    }
    return null;
  } catch {
    return null; // Chronik down or shape mismatch -> caller falls back to cache
  }
}

/** Lazily re-verify that `account` still holds its display handle's token.
 *  Updates the cache when stale. Never throws; returns the handle to display. */
async function freshDisplayHandle(account: {
  id: string;
  display_handle: string | null;
  active_handle_token_id: string | null;
  display_handle_checked_at: string | null;
}): Promise<string | null> {
  if (!account.active_handle_token_id) return null;

  const lastChecked = account.display_handle_checked_at
    ? Date.parse(account.display_handle_checked_at)
    : 0;
  const fresh = Date.now() - lastChecked < HOLDER_TTL_MS;
  if (fresh) return account.display_handle;

  const supabase = createServerSupabase();

  // Who does this account claim as its primary wallet?
  const { data: primary } = await supabase
    .from("account_addresses")
    .select("address")
    .eq("account_id", account.id)
    .eq("is_primary", true)
    .maybeSingle();

  const holder = await currentTokenHolder(account.active_handle_token_id);
  if (!holder || !primary?.address) {
    // couldn't verify -> serve cache, don't churn the timestamp
    return account.display_handle;
  }

  const stillHeld = holder === primary.address;
  const now = new Date().toISOString();

  if (stillHeld) {
    await supabase
      .from("accounts")
      .update({ display_handle_checked_at: now })
      .eq("id", account.id);
    return account.display_handle;
  }

  // handle has moved wallets -> this account no longer displays it
  await supabase
    .from("accounts")
    .update({ active_handle_token_id: null, display_handle: null, display_handle_checked_at: now })
    .eq("id", account.id);
  return null;
}

// ---------------------------------------------------------------------------
//  resolution paths
// ---------------------------------------------------------------------------

async function resolveHandle(handleRaw: string): Promise<ResolvedProfile | null> {
  const supabase = createServerSupabase();
  const sk = skeleton(handleRaw);

  const { data: h } = await supabase
    .from("handles")
    .select("token_id, handle, image_url")
    .eq("handle_skeleton", sk)
    .maybeSingle();
  if (!h?.token_id) return null;

  // Current on-chain holder is the source of truth, independent of any login.
  const holder = await currentTokenHolder(h.token_id); // "ecash:q…" | null (Chronik down)

  // Attribute the handle to an author (for their posts) via the holder address.
  // A holder with no author -> handle-only profile (author stays null).
  let author = holder ? await authorForAddress(holder) : null;

  // Resilience: if Chronik was unavailable, fall back to whatever account is
  // currently bound to this token so the profile still resolves during an outage.
  if (!holder) {
    const { data: bound } = await supabase
      .from("accounts")
      .select("author_id")
      .eq("active_handle_token_id", h.token_id)
      .maybeSingle();
    if (bound?.author_id) author = await authorById(bound.author_id);
  }

  return {
    kind: "handle",
    author,
    displayHandle: h.handle,
    identity: `@${h.handle}`,
    tokenId: h.token_id,
    holderAddress: holder ? normalizeAddress(holder) : null,
    cardImageUrl: (h as { image_url?: string | null }).image_url ?? null,
  };
}

async function resolveAddress(addressRaw: string): Promise<ResolvedProfile | null> {
  const address = normalizeAddress(addressRaw);
  if (!address) return null;

  const supabase = createServerSupabase();
  const forms = addressForms(address);

  // 1) via account_addresses -> account -> author
  const { data: links } = await supabase
    .from("account_addresses")
    .select("account_id")
    .in("address", forms)
    .limit(1);
  const link = links?.[0];

  if (link?.account_id) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id, author_id, display_handle, active_handle_token_id, display_handle_checked_at")
      .eq("id", link.account_id)
      .maybeSingle();

    if (account?.author_id) {
      const author = await authorById(account.author_id);
      if (author) {
        const displayHandle = await freshDisplayHandle(account as any);
        return {
          kind: "address",
          author,
          displayHandle,
          identity: displayHandle ? `@${displayHandle}` : address,
          tokenId: account.active_handle_token_id ?? null,
          holderAddress: address,
          cardImageUrl: null,
        };
      }
    }
  }

  // 2) fallback: authors.xec_address directly (author who never got an account row)
  const { data: authors } = await supabase
    .from("authors")
    .select("id, username, bio, xec_address")
    .in("xec_address", forms)
    .limit(1);
  const author = authors?.[0];

  if (author) {
    return {
      kind: "address",
      author: author as Author,
      displayHandle: null,
      identity: address,
      tokenId: null,
      holderAddress: address,
      cardImageUrl: null,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
//  public entry point
// ---------------------------------------------------------------------------

/** Resolve the /@<identifier> segment to a profile, or null if nothing matches.
 *  Tries the address interpretation first (unambiguous, 42-char base32), then
 *  falls back to treating it as a handle. */
export async function resolveProfileByIdentifier(
  identifierRaw: string,
): Promise<ResolvedProfile | null> {
  const id = (identifierRaw ?? "").trim();
  if (!id) return null;

  // An eCash address can't collide with a handle (handles are ≤30 chars; a bare
  // address is 42 base32 chars), so classifying by "is it a valid address" is safe.
  if (normalizeAddress(id)) {
    return resolveAddress(id);
  }
  return resolveHandle(id);
}
