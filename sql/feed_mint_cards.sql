-- Handle-mint feed cards. When a handle NFT is minted, mintProcessor inserts a
-- feed_posts row whose txid IS the NFT genesis txid (== token id), so every
-- reply/quote/like/repost — all of which resolve their target by feed_posts.txid
-- — works natively, and the card ranks through the normal engagement pipeline.
--
-- These three columns are NULL for ordinary posts; a mint card sets all three.
-- The row keeps action = 1 (POST) so it flows through TOP_LEVEL_ACTIONS and the
-- existing feed_posts_toplevel_created_idx with no index change; the renderer
-- branches on card_kind. Apply in the Supabase SQL editor (source-of-record).

ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS card_kind  text;   -- NULL = normal post; 'handle_mint' = mint card
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS image_url  text;   -- rendered NFT card PNG (mint cards only)
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS card_meta  jsonb;  -- { handle, tier, priceXec, minterAddress } for rendering

-- (No new index needed: mint cards use action = 1, already covered by
--  feed_posts_toplevel_created_idx. card_kind is read, never filtered in a hot path.)
