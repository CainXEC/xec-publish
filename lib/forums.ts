// =============================================================================
//  lib/forums.ts — forum lookups + the engagement-fee redirect.
//
//  A forum's RUNNER earns the fee on replies + POSITIVE reactions to posts IN
//  their forum: the 6% leg that normally goes to the platform is redirected to
//  the runner's LIVE payout address (account-bound, like handle earnings). A 👎
//  (platform-only) and every non-forum target still pay the platform. The
//  recipient is derived SERVER-SIDE from the target post's forum_id, so it can't
//  be spoofed by the client.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { skeleton } from "@/lib/handleSkeleton";
import { primaryAddressForAccount } from "@/lib/walletAuth";

// One-time forum creation fee (100% to the platform): anti-spam + revenue +
// makes forum names scarce/valuable. Kept modest because the @handle-holder gate
// already does the heavy anti-spam lifting (a handle costs 10K–1M XEC) — this is
// a second, smaller speed bump, matched to a base handle mint.
export const FORUM_CREATE_FEE_XEC = 10000;

// Forum slugs are subreddit-like: 2–24 chars, letters/digits/underscore, no
// leading/trailing underscore. Uniqueness is case-insensitive + confusable-folded
// via the shared handle skeleton (so /f/Bitcoin and /f/bitcoin can't co-exist).
const FORUM_SLUG_RE = /^[A-Za-z0-9_]{2,24}$/;

/** Validate a forum slug's syntax. Returns an error string, or null if valid. */
export function validateForumSlug(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!FORUM_SLUG_RE.test(s)) {
    return "Forum names must be 2–24 chars: letters, numbers, and underscore.";
  }
  if (s.startsWith("_") || s.endsWith("_")) {
    return "Forum names can’t start or end with an underscore.";
  }
  return null;
}

/** The case-insensitive/confusable-folded uniqueness key for a forum slug. */
export function forumSkeleton(slug: string): string {
  return skeleton(slug);
}

export interface ForumRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  runner_account_id: string;
  created_at: string;
  post_count: number;
}

const FORUM_COLUMNS =
  "id, slug, title, description, runner_account_id, created_at, post_count";

/** Look up a forum by its display slug (matched case-insensitively via skeleton). */
export async function getForumBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<ForumRow | null> {
  const { data } = await supabase
    .from("forums")
    .select(FORUM_COLUMNS)
    .eq("slug_skeleton", forumSkeleton(slug))
    .maybeSingle();
  return (data as ForumRow | null) ?? null;
}

/** Look up a forum by id. */
export async function getForumById(
  supabase: SupabaseClient,
  id: string
): Promise<ForumRow | null> {
  const { data } = await supabase
    .from("forums")
    .select(FORUM_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as ForumRow | null) ?? null;
}

/**
 * Who receives the fee leg (the "platform" 6%) for a reply/reaction against
 * `targetTxid`. If the target post is in a forum AND the action pays the author
 * 94/6 (a reply or a positive reaction), the RUNNER's live payout is returned;
 * a 👎 (`platformOnly`) or a non-forum target returns the platform address. So
 * the split builder + verification just use this address as the fee recipient.
 */
export async function feeRecipientForTarget(
  supabase: SupabaseClient,
  targetTxid: string,
  { platformOnly, platformAddress }: { platformOnly: boolean; platformAddress: string }
): Promise<string> {
  // A 👎 always pays the platform — a runner shouldn't profit from downvotes.
  if (platformOnly) return platformAddress;

  const { data: post } = await supabase
    .from("feed_posts")
    .select("forum_id")
    .eq("txid", targetTxid)
    .maybeSingle();
  const forumId = (post as { forum_id: string | null } | null)?.forum_id ?? null;
  return feeRecipientForForumId(supabase, forumId, platformAddress);
}

/**
 * The fee-leg recipient given a KNOWN forum id (or null) — the runner's live
 * payout, else the platform. Lets a caller that already has the target's forum_id
 * (e.g. a reply confirm that fetched the parent) skip re-querying it.
 */
export async function feeRecipientForForumId(
  supabase: SupabaseClient,
  forumId: string | null,
  platformAddress: string
): Promise<string> {
  if (!forumId) return platformAddress;

  const forum = await getForumById(supabase, forumId);
  if (!forum) return platformAddress;

  // Fees follow the runner's ACCOUNT — resolve its live primary; fall back to
  // the platform if (somehow) the runner has no address, so a fee is never lost.
  return primaryAddressForAccount(forum.runner_account_id, platformAddress);
}

/**
 * If `targetTxid` is a post in a forum, who runs it — so the confirm routes can
 * NOTIFY the runner that they earned the engagement fee. Returns the runner's
 * account id + the forum slug, or null when the target isn't in a forum.
 */
export async function forumFeeContext(
  supabase: SupabaseClient,
  targetTxid: string
): Promise<{ runnerAccountId: string; forumSlug: string } | null> {
  const { data: post } = await supabase
    .from("feed_posts")
    .select("forum_id")
    .eq("txid", targetTxid)
    .maybeSingle();
  const forumId = (post as { forum_id: string | null } | null)?.forum_id ?? null;
  if (!forumId) return null;
  const forum = await getForumById(supabase, forumId);
  if (!forum) return null;
  return { runnerAccountId: forum.runner_account_id, forumSlug: forum.slug };
}
