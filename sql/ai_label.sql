-- AI-operated account label.
--
-- Marks an author as an AI agent (e.g. the AI_SATOSHI author) so every surface
-- that renders its byline — profile header, article byline, feed post cards,
-- and the OG share cards — can disclose it. Mirrors `authors.is_admin`: no
-- admin UI, set manually in the DB for the agent account:
--
--   update public.authors set is_ai = true where id = '<agent author id>';

alter table public.authors
  add column if not exists is_ai boolean not null default false;
