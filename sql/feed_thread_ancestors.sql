-- =============================================================================
--  get_feed_ancestors(p_txid, p_max_depth) — the parent chain above a feed post,
--  root-first, in ONE round-trip.
--
--  Replaces the sequential walk in lib/getFeed.js getFeedThread(), which fetched
--  the chain one parent at a time (each parent's txid is only known after the
--  previous row loads) — up to MAX_ANCESTORS serial queries for a deep thread.
--  A recursive CTE climbs the same chain server-side and returns full feed_posts
--  rows ordered root-first (so the caller no longer reverses).
--
--  Semantics match the old JS walk exactly:
--    - starts at the focus post's parent, only when the focus is a reply (action=2)
--    - climbs while each row is itself a reply with a parent
--    - stops at a top-level post, a missing parent, or p_max_depth rows
--    - depth < p_max_depth also bounds any cycle (no runaway recursion)
--  The CTE carries only txid+depth+link fields; the final join re-reads the full
--  row so the result is a clean `setof feed_posts` (same columns the caller's
--  FEED_POST_COLUMNS select produced).
--
--  Apply in the Supabase SQL editor. Safe to re-run.
-- =============================================================================

create or replace function public.get_feed_ancestors(
  p_txid text,
  p_max_depth int default 20
)
returns setof public.feed_posts
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    -- anchor: the immediate parent of the focus post (only if the focus is a reply)
    select p.txid as txid, p.parent_txid as parent_txid, p.action as action, 1 as depth
      from feed_posts p
     where p.txid = (
       select parent_txid from feed_posts
        where txid = p_txid and action = 2 and parent_txid is not null
     )
    union all
    -- climb: each reply's parent, bounded by depth (also breaks any cycle)
    select par.txid, par.parent_txid, par.action, c.depth + 1
      from chain c
      join feed_posts par on par.txid = c.parent_txid
     where c.action = 2
       and c.parent_txid is not null
       and c.depth < p_max_depth
  )
  select fp.*
    from chain c
    join feed_posts fp on fp.txid = c.txid
   order by c.depth desc;   -- deepest depth = furthest ancestor = root first
$$;

-- Read-only, but service-role only to match the repo's no-public-grants posture.
revoke all on function public.get_feed_ancestors(text, int) from public;
revoke all on function public.get_feed_ancestors(text, int) from anon;
revoke all on function public.get_feed_ancestors(text, int) from authenticated;
grant execute on function public.get_feed_ancestors(text, int) to service_role;
