-- =============================================================================
--  sql/handle_colors_palette.sql
--  Widen accounts.handle_color to the 9-swatch palette (lib/handleColors.js).
--
--  The app validates the picked color against HANDLE_COLORS (isApprovedHandleColor),
--  but accounts.handle_color also carries a DB CHECK constraint as defense-in-depth
--  — so the new Teal/Blue/Pink/Orange swatches are rejected on save until this runs.
--  NULL is always allowed (= the default neon byline). Existing values are all kept,
--  so no row can violate the new constraint and nothing needs migrating.
--
--  Idempotent + name-agnostic: drops ANY existing CHECK on handle_color (the
--  original was created in the Supabase dashboard, name unknown here), then adds
--  ours. Safe to re-run.
-- =============================================================================

do $$
declare c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%handle_color%'
  loop
    execute format('alter table public.accounts drop constraint %I', c);
  end loop;
end $$;

alter table public.accounts
  add constraint accounts_handle_color_check
  check (
    handle_color is null
    or handle_color in (
      '#00ff9c', -- Neon
      '#22d3bb', -- Teal
      '#3df0ff', -- Cyan
      '#5b9dff', -- Blue
      '#b085ff', -- Violet
      '#ff6ad5', -- Pink
      '#ff5c6c', -- Coral
      '#ff9142', -- Orange
      '#ffd166'  -- Gold
    )
  );
