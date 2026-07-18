-- =============================================================================
--  Site search: Postgres full-text (articles + feed posts) and fuzzy handles.
--  Apply in the Supabase SQL editor. Safe to re-run.
--
--  THE INVARIANT (the whole point of this file):
--    The search index must NEVER contain text from the locked, post-paywall
--    portion of an article. If it did, search becomes a paywall oracle — query
--    a distinctive phrase, confirm/reconstruct locked content without paying.
--    Same trust boundary as lib/splitPostBodyAtPaywall.js.
--
--  HOW IT IS ENFORCED (schema-level, not application discipline):
--    posts.search_tsv is a GENERATED column whose expression derives the free
--    portion from posts.body ITSELF, by cutting at the first case-insensitive
--    occurrence of the paywall marker's attribute name ('data-paywall-break')
--    via post_public_search_text() below. No write path populates anything, so
--    no write path can regress it: whatever lands in `body`, the schema
--    re-splits it. Old rows index automatically — no backfill.
--
--    Why cutting at the ATTRIBUTE NAME is airtight: any marker variant the
--    runtime splitter accepts (its fallback regex is
--    /<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/i) must contain
--    the substring 'data-paywall-break' in some casing. We cut at the FIRST
--    such occurrence, so the SQL cut position is always AT OR BEFORE the
--    runtime split position. The only possible failure direction is
--    UNDER-indexing (e.g. free text that merely mentions the attribute name),
--    never over-indexing. regexp_instr positions refer to the original string,
--    so there is no lower()/length drift either.
--
--    The marker string is therefore load-bearing in TWO places: this file and
--    lib/splitPostBodyAtPaywall.js. Changing the marker means migrating both
--    (and rebuilding search_tsv: DROP COLUMN + re-ADD recomputes it).
--
--  ts_headline snippets run over post_public_search_text(body) — the SAME
--  function that feeds the index — so index and snippet can never diverge.
--
--  Feed posts are free-to-read: their whole content is indexed.
--  People search matches accounts.display_handle ONLY — the account's CURRENT
--  display identity. Former handles are not indexed anywhere, so a changed or
--  sold handle stops matching its old account (the LOCKED identity model:
--  earnings follow the account, identity follows the on-chain handle holder).
--
--  Requires Postgres 15+ (regexp_instr). Supabase projects and the local test
--  harness both qualify; on anything older this file fails loudly at apply.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
--  The free (pre-paywall) text of an article body, as plain text.
--  IMMUTABLE so it can feed a generated column. Also the ts_headline source.
--  Steps: cut at the paywall marker attribute -> strip tags -> collapse nbsp.
--  The 250k-char cap keeps a pathological body under the 1MB tsvector limit
--  (product cap is 200k plain chars, so nothing real is ever truncated).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_public_search_text(p_body text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT left(
    regexp_replace(
      regexp_replace(
        CASE
          WHEN s.marker_pos > 0 THEN left(s.body, s.marker_pos - 1)
          ELSE s.body
        END,
        '<[^>]*>', ' ', 'g'),
      '&nbsp;|' || chr(160), ' ', 'gi'),
    250000)
  FROM (
    SELECT coalesce(p_body, '') AS body,
           regexp_instr(coalesce(p_body, ''), 'data-paywall-break', 1, 1, 0, 'i') AS marker_pos
  ) s
$$;

-- Whether an article body contains a paywall marker at all (the `locked` flag
-- on search results). Case-insensitive, same detection as the split above.
CREATE OR REPLACE FUNCTION public.post_has_paywall(p_body text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_instr(coalesce(p_body, ''), 'data-paywall-break', 1, 1, 0, 'i') > 0
$$;

-- ---------------------------------------------------------------------------
--  Generated tsvector columns + GIN indexes.
--  NOTE: because these are GENERATED, re-running this file never recomputes
--  existing rows. To change the derivation (e.g. a new marker), DROP the
--  column, update the function, and re-ADD — that rebuilds every row.
-- ---------------------------------------------------------------------------

-- Articles: title (weight A) + free portion of the body (weight B). The
-- expression references NOTHING but title and the schema-split free text —
-- the locked portion is physically absent from the index.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', public.post_public_search_text(body)), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS posts_search_tsv_idx
  ON public.posts USING gin (search_tsv);

-- Feed posts are free-to-read: index the whole content.
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', left(coalesce(content, ''), 20000))
  ) STORED;

CREATE INDEX IF NOT EXISTS feed_posts_search_tsv_idx
  ON public.feed_posts USING gin (search_tsv);

-- Fuzzy people search over the CURRENT display handle (typo tolerance via
-- trigrams; the same index accelerates the substring ILIKE arm).
CREATE INDEX IF NOT EXISTS accounts_display_handle_trgm_idx
  ON public.accounts USING gin (display_handle gin_trgm_ops);

-- ---------------------------------------------------------------------------
--  search_site(query, type, limit) — the one unified search entrypoint.
--  type: NULL = all three groups | 'articles' | 'posts' | 'people'.
--  Search-path includes 'extensions' because Supabase installs pg_trgm there;
--  a nonexistent schema in search_path is ignored, so this also runs on a
--  vanilla Postgres where the extension lives in public.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_site(
  p_query text,
  p_type  text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  result_type          text,
  id                   text,
  title                text,
  slug                 text,
  is_legacy            boolean,
  snippet              text,
  locked               boolean,
  price_xec            numeric,
  reading_time_minutes integer,
  author_id            uuid,
  account_id           uuid,
  author_identity      text,
  handle_color         text,
  created_at           timestamptz,
  rank                 real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH params AS (
    SELECT
      left(btrim(coalesce(p_query, '')), 200)                                   AS q,
      websearch_to_tsquery('english', left(btrim(coalesce(p_query, '')), 200))  AS tsq,
      LEAST(GREATEST(coalesce(p_limit, 10), 1), 25)                             AS lim,
      nullif(lower(btrim(coalesce(p_type, ''))), '')                            AS want
  )

  -- Articles: published only. Snippet + locked flag both derive from the
  -- free portion ONLY (post_public_search_text) — never the raw body.
  (
    SELECT
      'article'::text                                   AS result_type,
      p.id::text                                        AS id,
      p.title                                           AS title,
      p.slug                                            AS slug,
      p.legacy                                          AS is_legacy,
      ts_headline('english',
        public.post_public_search_text(p.body),
        par.tsq,
        'StartSel=⟦, StopSel=⟧, MaxFragments=2, MaxWords=18, MinWords=6, FragmentDelimiter=" … "'
      )                                                 AS snippet,
      public.post_has_paywall(p.body)                   AS locked,
      p.price_xec::numeric                              AS price_xec,
      p.reading_time_minutes                            AS reading_time_minutes,
      p.author_id                                       AS author_id,
      NULL::uuid                                        AS account_id,
      NULL::text                                        AS author_identity,
      NULL::text                                        AS handle_color,
      coalesce(p.published_at, p.created_at)            AS created_at,
      ts_rank(p.search_tsv, par.tsq)::real              AS rank
    FROM public.posts p, params par
    WHERE (par.want IS NULL OR par.want = 'articles')
      AND p.published = true
      AND p.search_tsv @@ par.tsq
    ORDER BY ts_rank(p.search_tsv, par.tsq) DESC,
             coalesce(p.published_at, p.created_at) DESC
    LIMIT (SELECT lim FROM params)
  )

  UNION ALL

  -- Feed posts (posts / replies / quotes are all readable content).
  (
    SELECT
      'post'::text                                      AS result_type,
      f.txid                                            AS id,
      NULL::text                                        AS title,
      NULL::text                                        AS slug,
      NULL::boolean                                     AS is_legacy,
      ts_headline('english',
        f.content,
        par.tsq,
        'StartSel=⟦, StopSel=⟧, MaxFragments=2, MaxWords=18, MinWords=6, FragmentDelimiter=" … "'
      )                                                 AS snippet,
      false                                             AS locked,
      NULL::numeric                                     AS price_xec,
      NULL::integer                                     AS reading_time_minutes,
      NULL::uuid                                        AS author_id,
      f.author_account_id                               AS account_id,
      f.author_identity                                 AS author_identity,
      NULL::text                                        AS handle_color,
      f.created_at                                      AS created_at,
      ts_rank(f.search_tsv, par.tsq)::real              AS rank
    FROM public.feed_posts f, params par
    WHERE (par.want IS NULL OR par.want = 'posts')
      AND f.deleted_at IS NULL
      AND f.search_tsv @@ par.tsq
    ORDER BY ts_rank(f.search_tsv, par.tsq) DESC, f.created_at DESC
    LIMIT (SELECT lim FROM params)
  )

  UNION ALL

  -- People: fuzzy match on the account's CURRENT display handle. The trgm `%`
  -- arm catches typos; the escaped-ILIKE arm catches short/substring queries
  -- below the similarity threshold. Exact match first, then similarity().
  (
    SELECT
      'person'::text                                    AS result_type,
      a.id::text                                        AS id,
      a.display_handle                                  AS title,
      NULL::text                                        AS slug,
      NULL::boolean                                     AS is_legacy,
      NULL::text                                        AS snippet,
      false                                             AS locked,
      NULL::numeric                                     AS price_xec,
      NULL::integer                                     AS reading_time_minutes,
      a.author_id                                       AS author_id,
      a.id                                              AS account_id,
      NULL::text                                        AS author_identity,
      a.handle_color                                    AS handle_color,
      NULL::timestamptz                                 AS created_at,
      similarity(a.display_handle, par.q)::real         AS rank
    FROM public.accounts a, params par
    WHERE (par.want IS NULL OR par.want = 'people')
      AND a.display_handle IS NOT NULL
      AND par.q <> ''
      AND (
        a.display_handle % par.q
        OR a.display_handle ILIKE
             '%' || replace(replace(replace(par.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
    ORDER BY (lower(a.display_handle) = lower(par.q)) DESC,
             similarity(a.display_handle, par.q) DESC,
             a.display_handle ASC
    LIMIT (SELECT lim FROM params)
  )
$$;

-- ---------------------------------------------------------------------------
--  Rollback (run manually to undo; column drops also detach the functions):
--    DROP FUNCTION IF EXISTS public.search_site(text, text, integer);
--    DROP INDEX IF EXISTS public.accounts_display_handle_trgm_idx;
--    DROP INDEX IF EXISTS public.feed_posts_search_tsv_idx;
--    DROP INDEX IF EXISTS public.posts_search_tsv_idx;
--    ALTER TABLE public.feed_posts DROP COLUMN IF EXISTS search_tsv;
--    ALTER TABLE public.posts DROP COLUMN IF EXISTS search_tsv;
--    DROP FUNCTION IF EXISTS public.post_has_paywall(text);
--    DROP FUNCTION IF EXISTS public.post_public_search_text(text);
--    -- (leave pg_trgm installed; other features may adopt it)
-- ---------------------------------------------------------------------------
