-- =============================================================================
--  pow_mint_payment_unique.sql  —  a payment can fund at most ONE mint.
--
--  A POW (SLP) mint payment carries no mintId tag, so the sender+amount matcher
--  could re-detect the SAME POW send for another pending intent from the same
--  wallet — minting a second handle off one payment. The app now guards this in
--  claimPaidOrRefund; this index is the atomic backstop against the race.
--
--  First null out any EXISTING duplicate payment_txids (keep the earliest mint
--  per payment_txid — later dups were the erroneous free mints), so the unique
--  index can be created. Those NFTs are already delivered; nulling the reused
--  payment reference is bookkeeping only. Safe to re-run.
-- =============================================================================

with ranked as (
  select id,
         row_number() over (partition by payment_txid order by created_at) as rn
  from public.pending_mints
  where payment_txid is not null
)
update public.pending_mints m
   set payment_txid = null,
       error = coalesce(error, 'payment_txid cleared: reused across mints (pre-index cleanup)')
  from ranked r
 where m.id = r.id
   and r.rn > 1;

create unique index if not exists pending_mints_payment_txid_uniq
  on public.pending_mints (payment_txid)
  where payment_txid is not null;
