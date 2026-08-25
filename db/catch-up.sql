-- ===========================================================================
-- Paytag — catch-up: migrations 001 and 002 in one paste
--
-- For a Supabase project created before those two existed. It is exactly what
-- `migration-001-roles.sql` and `migration-002-account.sql` do, with the
-- commentary stripped, so it can be pasted into the SQL editor in one go:
--
--   1. cards.role + the directory view that reads it
--   2. payout_prefs (where a claim is allowed to pay)
--   3. claim_nonces.profile_id nullable, so the record of a signed
--      authorization outlives a deleted account
--   4. the PostgREST schema reload, without which the API keeps answering
--      "Could not find the 'role' column of 'cards' in the schema cache"
--
-- Safe to run twice. A project created from today's schema.sql needs none of
-- it; the individual migration files carry the reasoning behind each change.
--
-- Setup:  Supabase > SQL Editor > paste this file > Run
-- ===========================================================================

-- 1 ---------------------------------------------------------- cards.role
alter table public.cards add column if not exists role text;
update public.cards set role = 'dev' where role is null;
alter table public.cards alter column role set not null;
do $$ begin
  alter table public.cards add constraint cards_role_check
    check (role in ('shiller', 'dev'));
exception when duplicate_object then null; end $$;

create index if not exists cards_published_role_idx
  on public.cards (role, updated_at desc) where published;

drop view if exists public.public_cards;
create view public.public_cards with (security_invoker = true) as
select i.kind, i.handle, i.identity_key, i.external_login, i.verified_at,
       c.role, c.headline, c.summary, c.ecosystems, c.links, c.updated_at,
       (c.headline is not null) as has_card,
       p.id as profile_id, p.display_name,
       coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'handle', o.handle) order by o.kind)
                 from public.identities o where o.profile_id = p.id and o.id <> i.id), '[]'::jsonb)
         as linked_identities
from public.identities i
join public.profiles p on p.id = i.profile_id
left join public.cards c on c.identity_id = i.id and c.published;

-- 2 ------------------------------------------------------- payout_prefs
create table if not exists public.payout_prefs (
  identity_id uuid primary key references public.identities (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  address     text not null check (address ~ '^G[A-Z2-7]{55}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists payout_prefs_touch on public.payout_prefs;
create trigger payout_prefs_touch before update on public.payout_prefs
  for each row execute function public.touch_updated_at();

create or replace function public.payout_profile_matches_identity()
returns trigger language plpgsql as $$
declare owner uuid;
begin
  select profile_id into owner from public.identities where id = new.identity_id;
  if owner is null then raise exception 'identity not found: %', new.identity_id; end if;
  if owner <> new.profile_id then
    raise exception 'a payout address cannot be bound to a profile other than the identity''s owner';
  end if;
  return new;
end $$;

drop trigger if exists payout_prefs_owner_check on public.payout_prefs;
create trigger payout_prefs_owner_check before insert or update on public.payout_prefs
  for each row execute function public.payout_profile_matches_identity();

alter table public.payout_prefs enable row level security;
drop policy if exists payout_select_own on public.payout_prefs;
create policy payout_select_own on public.payout_prefs for select
  using (profile_id = (select auth.uid()));
drop policy if exists payout_insert_own on public.payout_prefs;
create policy payout_insert_own on public.payout_prefs for insert
  with check (profile_id = (select auth.uid()));
drop policy if exists payout_update_own on public.payout_prefs;
create policy payout_update_own on public.payout_prefs for update
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
drop policy if exists payout_delete_own on public.payout_prefs;
create policy payout_delete_own on public.payout_prefs for delete
  using (profile_id = (select auth.uid()));

-- 3 ------------------------- the nonce record outlives a deleted account
alter table public.claim_nonces alter column profile_id drop not null;
do $$ declare fk text;
begin
  select con.conname into fk from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname='public' and rel.relname='claim_nonces' and con.contype='f'
    and con.conkey = array[(select attnum from pg_attribute
      where attrelid = rel.oid and attname='profile_id')]::smallint[];
  if fk is not null then
    execute format('alter table public.claim_nonces drop constraint %I', fk);
  end if;
  alter table public.claim_nonces add constraint claim_nonces_profile_id_fkey
    foreign key (profile_id) references public.profiles (id) on delete set null;
end $$;

-- 4 --------------------------------------- let the REST API see all that
notify pgrst, 'reload schema';

select 'Paytag database is up to date.' as result;
