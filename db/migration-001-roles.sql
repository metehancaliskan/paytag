-- ===========================================================================
-- Paytag — migration 001: roles on cards
--
-- Why: the app grew a directory. Someone who wants to support the ecosystem
-- browses people, and the first thing they filter on is WHAT that person does.
-- Until now a card said what someone built but not which kind of contributor
-- they are, so the list could not be grouped at all.
--
-- Two roles fill a card:
--   shiller — writes, posts, explains, brings people in
--   dev     — ships code, tools, contracts, docs
-- The third kind of user in the product (a community member who sends money)
-- has no card, so it has no value here. If that changes, add the value to the
-- check constraint — the column deliberately refuses anything else today.
--
-- Safe to run more than once.
--
-- Setup:  Supabase > SQL Editor > paste this file > Run
-- ===========================================================================

-- ------------------------------------------------------------------ column

alter table public.cards
  add column if not exists role text;

-- Existing rows (there are none in practice, but a migration that assumes that
-- is a migration that fails on the one deployment where it is wrong) get the
-- broader of the two roles rather than being deleted.
update public.cards set role = 'dev' where role is null;

alter table public.cards
  alter column role set not null;

do $$
begin
  alter table public.cards
    add constraint cards_role_check check (role in ('shiller', 'dev'));
exception
  when duplicate_object then null;
end $$;

comment on column public.cards.role is
  'What kind of contributor this card belongs to: shiller | dev. Drives the directory filter.';

-- The directory reads published cards newest first. Without this it is a
-- sequential scan plus a sort on every page view.
create index if not exists cards_published_role_idx
  on public.cards (role, updated_at desc)
  where published;

-- -------------------------------------------------------------------- view
--
-- Recreated rather than altered: a view's column list cannot be extended in
-- place. Same definition as in schema.sql, plus `role` and `published`.
--
-- security_invoker stays on. Without it the view would read with the owner's
-- privileges and hand out unpublished cards to anyone who asked.

drop view if exists public.public_cards;

create view public.public_cards
with (security_invoker = true)
as
select
  i.kind,
  i.handle,
  i.identity_key,
  i.external_login,
  i.verified_at,
  c.role,
  c.headline,
  c.summary,
  c.ecosystems,
  c.links,
  c.updated_at,
  -- The directory asks for "everyone with a card"; a left join alone cannot
  -- express that without repeating the null check at every call site.
  (c.headline is not null) as has_card,
  p.id           as profile_id,
  p.display_name,
  coalesce(
    (
      select jsonb_agg(jsonb_build_object('kind', o.kind, 'handle', o.handle)
                       order by o.kind)
      from public.identities o
      where o.profile_id = p.id and o.id <> i.id
    ),
    '[]'::jsonb
  ) as linked_identities
from public.identities i
join public.profiles p on p.id = i.profile_id
left join public.cards c on c.identity_id = i.id and c.published;

comment on view public.public_cards is
  'The profile page and the directory read this. A row exists for every verified identity; has_card says whether a published card is attached.';

-- --------------------------------------------------------------- the check

do $$
declare
  n integer;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_cards'
    and column_name in ('role', 'has_card');
  if n <> 2 then
    raise exception 'public_cards is missing role/has_card — the view did not get recreated';
  end if;
  raise notice 'migration 001 applied: cards.role exists, public_cards exposes role and has_card.';
end $$;

select 'Migration 001 applied.' as result;
