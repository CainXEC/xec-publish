-- Feed-native notifications: one row per event delivered to a recipient account.
-- Keyed by public.accounts(id) on BOTH sides, because feed activity targets
-- accounts (most feed posters are reader-only accounts with no author_id, so the
-- legacy author-keyed `notifications` table can't represent them).
--
-- Five event types, all fired best-effort at the moment the on-chain action is
-- recorded (see lib/feedNotifications.js and the confirm/react/follow routes):
--   reply / quote / like / repost  -> post_txid = the post the recipient owns
--   follow                          -> post_txid NULL
--
-- actor_identity is a frozen byline snapshot ("@handle" or a raw address) so the
-- bell renders without a join back to accounts.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). Safe to re-run.

CREATE TABLE IF NOT EXISTS public.feed_notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  actor_account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  actor_identity       text NOT NULL,
  type                 text NOT NULL,
  post_txid            text,
  read                 boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_notifications_type_chk
    CHECK (type IN ('reply', 'quote', 'like', 'repost', 'follow')),
  -- Never notify yourself about your own action.
  CONSTRAINT feed_notifications_no_self
    CHECK (recipient_account_id <> actor_account_id)
);

-- Deny-by-default: the app only touches this via the service-role key (bypasses
-- RLS). Enabling RLS with NO policies locks out direct anon/authenticated access
-- without affecting server writes.
ALTER TABLE public.feed_notifications ENABLE ROW LEVEL SECURITY;

-- The bell's two queries: newest-first listing and the unread count, both scoped
-- to one recipient.
CREATE INDEX IF NOT EXISTS feed_notifications_recipient_idx
  ON public.feed_notifications (recipient_account_id, read, created_at DESC);

-- The hourly retention prune deletes across all recipients by age
-- (WHERE created_at < cutoff), so it needs a plain created_at index.
CREATE INDEX IF NOT EXISTS feed_notifications_created_idx
  ON public.feed_notifications (created_at);
