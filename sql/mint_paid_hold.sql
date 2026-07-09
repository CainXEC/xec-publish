-- Handle minting: replace the free 15-minute name hold with a PAID hold.
--
-- Previously an intent (POST /api/mint/intent) inserted a pending_mints row that
-- reserved the name for 15 minutes with NO payment — a free name-squat vector
-- (spam intents to lock desirable names). A partial unique index on
-- pending_mints.handle_skeleton enforced that free hold by rejecting a second
-- concurrent intent for the same name.
--
-- New model: a name is only "held" once a real payment is detected (status =
-- 'paid'). Unpaid intents no longer block anyone, so multiple people may start an
-- intent for the same name; the first paid + finalized one mints (serialized by
-- mint_lock, backstopped by the unique index on handles.handle_skeleton) and any
-- loser is auto-refunded on-chain. That means multiple unpaid pending_mints rows
-- for one skeleton must be allowed — so drop the unique index that forbade them.
--
-- Correctness does NOT depend on this index: only-one-mint-per-name is guaranteed
-- by the mint_lock + defensive re-check + handles.handle_skeleton unique index.

do $$
declare
  idx text;
begin
  for idx in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'pending_mints'
      and indexdef ilike '%unique%'
      and indexdef ilike '%handle_skeleton%'
  loop
    execute 'drop index if exists public.' || quote_ident(idx);
  end loop;
end $$;
