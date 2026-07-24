-- Add a frozen amount snapshot to notifications, so a paid reaction can say how
-- much was tipped. Currently used by 'like' (a like is a tip — the liker pays
-- the post's author, and may pay ABOVE the flat floor; see the react/confirm
-- path and lib/verifyFeedPost.js). Stored in SATS (1 XEC = 100 sats); the bell
-- divides by 100 to render "· 100 XEC". Nullable: older rows and non-paid types
-- (follow, etc.) simply have no amount and render the plain verb.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). Safe to re-run.

ALTER TABLE public.feed_notifications
  ADD COLUMN IF NOT EXISTS amount_sats bigint;
