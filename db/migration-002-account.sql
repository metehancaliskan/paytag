-- ===========================================================================
-- Paytag — migration 002: payout address, and an account you can delete
--
-- Two changes, both about giving a person control over their own account.
--
-- 1. payout_prefs — "where my escrow should land"
--
--    Until now the claim paid whichever wallet happened to be connected in the
--    browser at that moment. That is fine until it isn't: people claim from a
--    hot wallet and want the money in a cold one, and a session someone else
--    got hold of could name any destination it liked.
--
--    So the destination becomes something you declare in advance, and the
--    verifier refuses to sign for anything else. The escrow contract does not
--    require the recipient to authorize the transaction (contracts/escrow:
--    `claim` has no `recipient.require_auth()`), so the connected wallet can
--    submit the claim while the money goes somewhere else entirely.
--
--    It is a SEPARATE TABLE rather than a column on `identities`, and that is
--    the whole point of it. Row level security grants privileges per row, not
--    per column: an UPDATE policy on `identities` would let a user rewrite
--    their own `handle`, and then verification would mean nothing. `identities`
--    stays writable by the service role alone, forever.
--
-- 2. claim_nonces.profile_id becomes nullable, ON DELETE SET NULL
--
--    A person can now delete their account, and cascade would have taken the
--    record of every claim authorization ever signed for them with it. That
--    record is what guarantees the verifier signs a nonce at most once, and it
--    is the only trace an incident could be reconstructed from. It outlives the
--    account; what is left in the row (an identity key and a public wallet
--    address) is on chain in the claim transaction anyway.
--
-- Safe to run more than once.
--
-- Setup:  Supabase > SQL Editor > paste this file > Run
-- ===========================================================================

-- ------------------------------------------------------------ payout_prefs

create table if not exists public.payout_prefs (
  -- One destination per identity, not per account: the GitHub escrow and the X
  -- escrow are separate pools, and a person may well want them in separate
  -- wallets. Primary key on the identity says "at most one" without a trigger.
  identity_id uuid primary key references public.identities (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,

  -- A Stellar ed25519 public key in strkey form. The shape is checked here so a
  -- malformed row cannot exist at all; the CHECKSUM is checked in the
  -- application (lib/payout.ts), because base32 arithmetic does not belong in a
  -- CHECK constraint.
  address     text not null check (address ~ '^G[A-Z2-7]{55}$'),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.payout_prefs is
  'Where a claim on this identity must pay. When a row exists the verifier signs for this address and no other.';
comment on column public.payout_prefs.address is
  'Stellar public key (G...). Shape enforced here, checksum enforced in lib/payout.ts.';

drop trigger if exists payout_prefs_touch on public.payout_prefs;
create trigger payout_prefs_touch before update on public.payout_prefs
  for each row execute function public.touch_updated_at();

-- The same trap as on `cards`: a foreign key proves the identity exists and
-- proves the profile exists, but not that they belong together. Without this a
-- user could point a payout row at someone else's identity, and the verifier
-- would then happily sign that person's escrow over to them.
create or replace function public.payout_profile_matches_identity()
returns trigger
language plpgsql
as $$
declare
  owner uuid;
begin
  select profile_id into owner from public.identities where id = new.identity_id;
  if owner is null then
    raise exception 'identity not found: %', new.identity_id;
  end if;
  if owner <> new.profile_id then
    raise exception 'a payout address cannot be bound to a profile other than the identity''s owner';
  end if;
  return new;
end;
$$;

drop trigger if exists payout_prefs_owner_check on public.payout_prefs;
create trigger payout_prefs_owner_check before insert or update on public.payout_prefs
  for each row execute function public.payout_profile_matches_identity();

-- RLS: your own row, and nothing else. NOT world readable, unlike `identities`
-- — where a person keeps their money is nobody else's business, and publishing
-- it would hand an attacker the list of addresses worth going after.
alter table public.payout_prefs enable row level security;

drop policy if exists payout_select_own on public.payout_prefs;
create policy payout_select_own on public.payout_prefs
  for select using (profile_id = (select auth.uid()));

drop policy if exists payout_insert_own on public.payout_prefs;
create policy payout_insert_own on public.payout_prefs
  for insert with check (profile_id = (select auth.uid()));

drop policy if exists payout_update_own on public.payout_prefs;
create policy payout_update_own on public.payout_prefs
  for update using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists payout_delete_own on public.payout_prefs;
create policy payout_delete_own on public.payout_prefs
  for delete using (profile_id = (select auth.uid()));

-- ------------------------------------------------- claim_nonces retention

alter table public.claim_nonces
  alter column profile_id drop not null;

-- The constraint name is Postgres's default for this column; look it up rather
-- than assume, so a hand-named constraint is not left in place beside the new
-- one.
do $$
declare
  fk text;
begin
  select con.conname into fk
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'claim_nonces'
    and con.contype = 'f'
    and con.conkey = array[
      (select attnum from pg_attribute
        where attrelid = rel.oid and attname = 'profile_id')
    ]::smallint[];

  if fk is not null then
    execute format('alter table public.claim_nonces drop constraint %I', fk);
  end if;

  alter table public.claim_nonces
    add constraint claim_nonces_profile_id_fkey
    foreign key (profile_id) references public.profiles (id) on delete set null;
end $$;

comment on column public.claim_nonces.profile_id is
  'Who the authorization was signed for. NULL once that account is deleted — the record of the signature outlives the account.';

-- --------------------------------------------------------------- the check

do $$
declare
  nullable text;
  action   char;
  policies integer;
begin
  select is_nullable into nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'claim_nonces'
    and column_name = 'profile_id';
  if nullable <> 'YES' then
    raise exception 'claim_nonces.profile_id is still NOT NULL';
  end if;

  select con.confdeltype into action
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'claim_nonces'
    and con.contype = 'f' and con.conname = 'claim_nonces_profile_id_fkey';
  if action <> 'n' then
    raise exception 'claim_nonces.profile_id does not SET NULL on delete (got %)', action;
  end if;

  select count(*) into policies
  from pg_policies
  where schemaname = 'public' and tablename = 'payout_prefs';
  if policies <> 4 then
    raise exception 'payout_prefs should have 4 policies, found %', policies;
  end if;

  raise notice 'migration 002 applied: payout_prefs exists with 4 policies, nonce records survive account deletion.';
end $$;

-- ------------------------------------------------- tell the API about it
--
-- PostgREST serves Supabase's REST API from a CACHED copy of the schema. After
-- a DDL change it keeps answering from the old one, and a write to the new
-- column fails with:
--
--   Could not find the 'role' column of 'cards' in the schema cache
--
-- which reads like an application bug and is not one. This makes the reload
-- part of the migration instead of a thing somebody has to know.

notify pgrst, 'reload schema';

select 'Migration 002 applied.' as result;
