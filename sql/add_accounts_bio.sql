-- Reader bios.
--
-- Bios historically lived only on `authors.bio`, so reader accounts (no `authors`
-- row: kind='reader', author_id=NULL) had no place to write one. Add an
-- account-scoped `bio` column so any signed-in wallet can describe itself.
--
-- Authors keep using `authors.bio`; the profile read path prefers the author bio
-- and falls back to `accounts.bio`. Written by the account-scoped saveReaderBio
-- server action (service-role only — RLS stays no-policy on accounts).

alter table public.accounts
  add column if not exists bio text;
