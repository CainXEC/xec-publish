// =============================================================================
//  lib/handleOffers.ts — server helpers for the handle offer system.
//
//  Holdership is on-chain: the "holder" of a handle NFT is whoever's wallet
//  holds its single UTXO right now, so offers follow the token when it changes
//  hands. Resolution mirrors resolveProfile.ts: Chronik first (authoritative),
//  the accounts.active_handle_token_id binding as best-effort fallback when
//  Chronik is unreachable.
//
//  Used by app/api/handles/offer (place/withdraw) and /offers (read).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentTokenHolder } from "@/lib/resolveProfile";
import { fetchListedSellerAddress } from "@/lib/agoraMarketplace";
import { recordFeedNotification, resolveAccountByAddress } from "@/lib/feedNotifications";

const bare = (address: string) => address.replace(/^ecash:/, "").toLowerCase();
const addressForms = (address: string) => {
  const b = bare(address);
  return [b, `ecash:${b}`];
};

export const shortAddress = (address: string) => {
  const b = bare(address);
  return `${b.slice(0, 8)}…${b.slice(-4)}`;
};

/** The account that currently holds this token, or null when the holder's
 *  wallet has no proofofwriting account (a mint that never logged in). */
export async function holderAccountIdForToken(
  supabase: SupabaseClient,
  tokenId: string
): Promise<string | null> {
  const holder = await currentTokenHolder(tokenId); // "ecash:q…" | null (Chronik down)

  if (holder) {
    const { data: links } = await supabase
      .from("account_addresses")
      .select("account_id")
      .in("address", addressForms(holder))
      .limit(1);
    return (links?.[0]?.account_id as string | undefined) ?? null;
  }

  // Chronik unreachable — fall back to the account currently bound to the
  // token (same staleness the profile page accepts during an outage).
  const { data: boundAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("active_handle_token_id", tokenId)
    .maybeSingle();
  return (boundAccount?.id as string | undefined) ?? null;
}

/** Who an offer on this token should reach, and whether it's listed.
 *
 *  Two ways a handle can have an owner to notify:
 *    • held in a wallet (unlisted) → the account holding the token UTXO, via
 *      holderAccountIdForToken (Chronik → account).
 *    • listed on Agora → the token UTXO sits in the escrow covenant, so the
 *      on-chain "holder" is the covenant, NOT a person. We recover the lister
 *      from the offer's cancel pubkey (only their key can cancel/relist) and map
 *      that address to an account.
 *  `listed` lets the UI show the seller a "cancel then relist" flow instead of
 *  the one-tap list (you can't list an NFT that's already in escrow). */
export async function offerRecipientForToken(
  supabase: SupabaseClient,
  tokenId: string
): Promise<{ accountId: string | null; listed: boolean }> {
  const holder = await holderAccountIdForToken(supabase, tokenId);
  if (holder) return { accountId: holder, listed: false };

  // No wallet holder → maybe it's listed (token in the Agora covenant). Recover
  // the lister from the active offer. Best-effort: an Agora/Chronik hiccup just
  // means we can't resolve a recipient right now (no bell), never a wrong one.
  let sellerAddress: string | null = null;
  try {
    sellerAddress = await fetchListedSellerAddress(tokenId);
  } catch {
    return { accountId: null, listed: false };
  }
  if (!sellerAddress) return { accountId: null, listed: false };

  const { data: links } = await supabase
    .from("account_addresses")
    .select("account_id")
    .in("address", addressForms(sellerAddress))
    .limit(1);
  return { accountId: (links?.[0]?.account_id as string | undefined) ?? null, listed: true };
}

/** A currently-active listing, as much as the reconcile below needs. */
export interface ListingForReconcile {
  tokenId: string;
  priceSats: bigint;
  sellerAddress: string | null;
}

/**
 * Notify bidders whose offered price now matches a live listing.
 *
 *  The "List at N" button only opens Cashtab — it can't confirm the holder
 *  actually listed at that price (they might cancel or change the number). So we
 *  don't notify on the click; we reconcile ACTUAL on-chain listings against open
 *  offers here (called from the marketplace read, best-effort in the background):
 *  when a handle is listed at a price that EXACTLY matches an open bid, that
 *  bidder gets one 'offer_listed' bell.
 *
 *  `listed_notified_sats` records the price we last told a given bidder about, so
 *  a bidder is notified once per matching price — not on every gallery load, and
 *  again only if the listing later re-matches a (changed) offer price. A
 *  conditional update is the lock: only the reconcile that flips that column
 *  sends the bell, so concurrent gallery loads can't double-ring it.
 *
 *  Requires sql/handle_offer_listed_notify.sql (the column + notif type). Never
 *  throws — a reconcile failure just means no bell this pass.
 */
export async function reconcileListedOffers(
  supabase: SupabaseClient,
  listings: ListingForReconcile[]
): Promise<void> {
  if (listings.length === 0) return;
  const byToken = new Map(listings.map((l) => [l.tokenId, l]));

  const { data: offers } = await supabase
    .from("handle_offers")
    .select("id, token_id, bidder_account_id, amount_sats, listed_notified_sats")
    .in("token_id", [...byToken.keys()])
    .eq("status", "open")
    .not("amount_sats", "is", null);
  if (!offers || offers.length === 0) return;

  // Resolve the lister once per token (one seller per oneshot listing).
  const sellerCache = new Map<string, { accountId: string; identity: string } | null>();

  for (const o of offers as Array<{
    id: string;
    token_id: string;
    bidder_account_id: string;
    amount_sats: number;
    listed_notified_sats: number | null;
  }>) {
    const listing = byToken.get(o.token_id);
    if (!listing) continue;
    if (o.amount_sats !== Number(listing.priceSats)) continue; // not listed at THIS bid's price
    if (o.listed_notified_sats === o.amount_sats) continue; // already told this bidder

    let seller = sellerCache.get(o.token_id);
    if (seller === undefined) {
      seller = listing.sellerAddress
        ? await resolveAccountByAddress(supabase, listing.sellerAddress)
        : null;
      sellerCache.set(o.token_id, seller);
    }
    // No account behind the lister (pure-Cashtab seller) → nothing to attribute
    // the bell to; skip. Can't happen for our own button (seller is logged in).
    if (!seller?.accountId || seller.accountId === o.bidder_account_id) continue;

    // Claim-before-notify: only the writer that flips listed_notified_sats rings
    // the bell (concurrent reconciles serialize on the row and see it already set).
    const { data: claimed } = await supabase
      .from("handle_offers")
      .update({ listed_notified_sats: o.amount_sats })
      .eq("id", o.id)
      .or(`listed_notified_sats.is.null,listed_notified_sats.neq.${o.amount_sats}`)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    await recordFeedNotification(supabase, {
      recipientAccountId: o.bidder_account_id,
      actorAccountId: seller.accountId,
      actorIdentity: seller.identity,
      type: "offer_listed",
      postTxid: o.token_id,
      amountSats: o.amount_sats,
    });
  }
}

/** Display bylines for a set of accounts: "@handle" when one is displayed,
 *  else the account's primary address, shortened. Keyed by account id. */
export async function bidderDisplayMap(
  supabase: SupabaseClient,
  accountIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (accountIds.length === 0) return out;

  const [{ data: accounts }, { data: addresses }] = await Promise.all([
    supabase.from("accounts").select("id, display_handle").in("id", accountIds),
    supabase
      .from("account_addresses")
      .select("account_id, address")
      .in("account_id", accountIds)
      .eq("is_primary", true),
  ]);

  const primaryByAccount = new Map(
    (addresses ?? []).map((a: { account_id: string; address: string }) => [
      a.account_id,
      a.address,
    ])
  );
  for (const a of (accounts ?? []) as Array<{ id: string; display_handle: string | null }>) {
    const primary = primaryByAccount.get(a.id);
    out.set(a.id, a.display_handle ? `@${a.display_handle}` : primary ? shortAddress(primary) : "a collector");
  }
  return out;
}

/** For a set of seller eCash addresses (from listed Agora offers), the live
 *  display handle of the account behind each — keyed by BARE address. Only
 *  sellers who have logged in AND currently display a handle appear; a pure
 *  Cashtab lister (no account / no handle) is simply absent, and the card shows
 *  no "listed by" byline for them. Public-safe: exposes only the handle. */
export async function sellerHandleMap(
  supabase: SupabaseClient,
  addresses: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const bareUnique = [...new Set(addresses.map(bare))];
  if (bareUnique.length === 0) return out;

  const allForms = bareUnique.flatMap(addressForms);
  const { data: links } = await supabase
    .from("account_addresses")
    .select("account_id, address")
    .in("address", allForms);
  if (!links || links.length === 0) return out;

  const accountByBare = new Map<string, string>();
  for (const l of links as Array<{ account_id: string; address: string }>) {
    accountByBare.set(bare(l.address), l.account_id);
  }

  const accountIds = [...new Set([...accountByBare.values()])];
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, display_handle")
    .in("id", accountIds);
  const handleByAccount = new Map(
    ((accounts ?? []) as Array<{ id: string; display_handle: string | null }>)
      .filter((a) => a.display_handle)
      .map((a) => [a.id, a.display_handle as string])
  );

  for (const b of bareUnique) {
    const accId = accountByBare.get(b);
    const handle = accId ? handleByAccount.get(accId) : undefined;
    if (handle) out.set(b, handle);
  }
  return out;
}
