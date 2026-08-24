-- ===========================================================================
-- Paytag — Supabase schema
--
-- This schema carries exactly one rule: THE MONEY IS ON CHAIN, NOT HERE.
-- Every one of these tables could be dropped and not a cent held in escrow
-- would be lost; the money is in the contract, and `identity_key` can be
-- recomputed from the handle at any moment. What is kept here is only "who is
-- who" and "how each person describes themselves".
--
-- Consequence: this database is not a ledger, it is a shop window. It was
-- designed accordingly — off the critical path, and its loss is recoverable.
--
-- Setup:  Supabase > SQL Editor > paste this file > Run
-- ===========================================================================

-- ---------------------------------------------------------------- profiles
--
-- A Paytag account. Bound one-to-one to the user in Supabase Auth.
-- However many identities a user has, there is a single profile; this row is
-- what ties the cards to each other.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Paytag account. Identities and cards hang off this.';

-- -------------------------------------------------------------- identities
--
-- A verified internet identity. IF THE ROW EXISTS, IT IS VERIFIED —
-- `verified_at` is NOT NULL, so there is no such state as an "unverified
-- identity". If verification is abandoned halfway, the row is never written.
--
-- The `kind` values are the same as in SPEC.md §2: 0=GithubUser, 2=XUser.
-- 1 (GithubRepo) and 3 (PaytagNick) are reserved and have no normalization
-- rule yet.

create table if not exists public.identities (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,

  kind          smallint not null check (kind in (0, 2)),

  -- The form that has been through the SPEC §2.1 / §2.4 rules. In the
  -- application `normalizeHandle()` produces it; there is only a coarse
  -- consistency check here — we do not copy the rule into SQL so that the real
  -- authority stays in one single place.
  handle        text not null check (handle = lower(handle) and length(handle) between 1 and 39),

  -- The provider's permanent numeric id. The handle changes, this does not.
  -- The antidote to the "handle transfer" risk in §6.2: at claim time the
  -- verifier can ask "does this handle still belong to this id".
  external_id   text not null,

  -- The original spelling the provider returned (MixedCase). For display only;
  -- no computation is ever based on it.
  external_login text,

  -- sha256(kind ‖ handle), 64 hex digits. The application computes it and
  -- writes it here. The only reason it is stored is queryability; the source of
  -- truth is still identity.ts.
  identity_key  text not null check (identity_key ~ '^[0-9a-f]{64}$'),

  verified_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  -- A single handle can be held by only one profile at a time.
  constraint identities_kind_handle_key unique (kind, handle),
  -- The same provider account cannot be bound to two profiles.
  constraint identities_kind_external_key unique (kind, external_id),
  -- A profile verifies at most one identity of each kind.
  constraint identities_profile_kind_key unique (profile_id, kind)
);

create index if not exists identities_identity_key_idx
  on public.identities (identity_key);

comment on table public.identities is
  'Verified identity. The existence of the row is the proof of verification.';
comment on column public.identities.external_id is
  'The provider''s permanent numeric id — fixed even if the handle changes hands.';

-- ------------------------------------------------------------------- cards
--
-- A contribution card. One per identity: the GitHub card and the X card are
-- separate rows, separate texts, separate escrow pools.
--
-- Hanging it off `identity_id` bakes the "verify first, then card" rule into
-- the schema itself: since there is no such thing as an unverified identity
-- row, an unverified card cannot be written either. Had this rule been left to
-- the application layer, a single forgotten check would have been enough.

create table if not exists public.cards (
  identity_id  uuid primary key references public.identities (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,

  headline     text not null check (length(headline) between 3 and 80),
  summary      text not null check (length(summary) between 20 and 1000),

  -- "Which ecosystem did you contribute to" — free-form tags.
  ecosystems   text[] not null default '{}',
  links        jsonb  not null default '[]'::jsonb,

  -- An unpublished card is a draft; only its owner sees it.
  published    boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.cards is
  'Contribution card. One per identity; no row can exist before the identity is verified.';

-- ------------------------------------------------------------ claim_nonces
--
-- One row per claim authorization the verifier has ever signed. The nonce is
-- the primary key, so the verifier can never sign the same one twice — not
-- even if two requests arrive in the same millisecond.
--
-- This is NOT the protection the contract has. The contract refuses a nonce it
-- has already seen on chain; it knows nothing about a signature that was issued
-- and never submitted. Both halves are needed: the contract stops replay, this
-- table stops double issuance.
--
-- Nothing here is a secret and nothing here is money. If the table were lost,
-- the contract's own replay check and the short `expires_at_ledger` window
-- would still hold.

create table if not exists public.claim_nonces (
  nonce             text primary key check (nonce ~ '^[0-9a-f]{64}$'),
  profile_id        uuid not null references public.profiles (id) on delete cascade,

  -- Which tag the signature was for, and where it was allowed to pay. Both are
  -- inside the signed preimage; kept here so an incident can be reconstructed
  -- from the database alone.
  identity_key      text not null check (identity_key ~ '^[0-9a-f]{64}$'),
  recipient         text not null check (length(recipient) = 56),

  expires_at_ledger integer not null check (expires_at_ledger > 0),
  created_at        timestamptz not null default now()
);

create index if not exists claim_nonces_profile_idx
  on public.claim_nonces (profile_id, created_at desc);

comment on table public.claim_nonces is
  'Every claim authorization ever signed. Guarantees the verifier signs a nonce at most once.';

-- Row level security ON with NO policies: that combination denies every request
-- from `anon` and `authenticated` outright. Only the service role — the
-- verifier endpoint, server side — touches this table.
alter table public.claim_nonces enable row level security;

-- ------------------------------------------------------------- update time

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before update on public.cards
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------ profile ↔ card consistency
--
-- `cards.profile_id` must match the identity's profile. Otherwise someone
-- could hang a card on somebody else's identity. Foreign keys do not catch
-- this on their own, so we check it explicitly.

create or replace function public.cards_profile_matches_identity()
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
    raise exception 'a card cannot be bound to a profile other than the identity''s owner';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_owner_check on public.cards;
create trigger cards_owner_check before insert or update on public.cards
  for each row execute function public.cards_profile_matches_identity();

-- --------------------------------------------------------------------- RLS
--
-- Default: nothing. Then opened up one at a time.
-- The investor side reads without logging in, so `anon` gets SELECT too — but
-- only on published cards.

alter table public.profiles   enable row level security;
alter table public.identities enable row level security;
alter table public.cards      enable row level security;

-- profiles ---------------------------------------------------------------

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- identities -------------------------------------------------------------
--
-- Anyone can read: the answer to "is this handle verified" is critical
-- information for an investor and is a publicly known fact anyway.
--
-- NO WRITE ACCESS. An identity row is written only by the server side
-- (service role), from the data returned by OAuth. If a user could write their
-- own identity, verification would mean nothing.

drop policy if exists identities_select_public on public.identities;
create policy identities_select_public on public.identities
  for select using (true);

-- cards ------------------------------------------------------------------

drop policy if exists cards_select_published on public.cards;
create policy cards_select_published on public.cards
  for select using (published or profile_id = (select auth.uid()));

drop policy if exists cards_insert_own on public.cards;
create policy cards_insert_own on public.cards
  for insert with check (profile_id = (select auth.uid()));

drop policy if exists cards_update_own on public.cards;
create policy cards_update_own on public.cards
  for update using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists cards_delete_own on public.cards;
create policy cards_delete_own on public.cards
  for delete using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------- the view
--
-- Everything the profile page needs in a single query: the card, the identity
-- and the OTHER verified identities ON THE SAME PROFILE (the linked-card
-- badge).
--
-- security_invoker: let the view run with the caller's privileges — otherwise
-- it would punch through RLS and leak unpublished cards.

create or replace view public.public_cards
with (security_invoker = true)
as
select
  i.kind,
  i.handle,
  i.identity_key,
  i.external_login,
  i.verified_at,
  c.headline,
  c.summary,
  c.ecosystems,
  c.links,
  c.updated_at,
  p.id           as profile_id,
  p.display_name,
  -- The other identities this person has verified: [{kind, handle}]
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
  'The view the profile page reads. A row is returned even with no card: the identity may be verified but the card not yet filled in.';
