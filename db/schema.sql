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
-- THIS FILE IS ALWAYS THE CURRENT SCHEMA. A fresh project needs nothing else:
-- the `migration-*.sql` files exist only for a deployment that already ran an
-- older version of this one. Whatever a migration adds is folded back in here
-- the same day, so "run schema.sql" is never half an install.
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

  -- What kind of contributor this is, and the directory's only filter:
  --   shiller — writes, posts, explains, brings people in
  --   dev     — ships code, tools, contracts, docs
  -- The third kind of user in the product sends money and has no card, so it
  -- has no value here. A third contributor role means editing this constraint.
  role         text not null check (role in ('shiller', 'dev')),

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
comment on column public.cards.role is
  'What kind of contributor this card belongs to: shiller | dev. Drives the directory filter.';

-- The directory reads published cards newest first. Without this it is a
-- sequential scan plus a sort on every page view.
create index if not exists cards_published_role_idx
  on public.cards (role, updated_at desc)
  where published;

-- ------------------------------------------------------------ payout_prefs
--
-- Where a claim on this identity must pay.
--
-- A destination declared in advance, rather than "whatever wallet is connected
-- right now": people claim from a hot wallet into a cold one, and a stolen
-- session should not be able to name its own address. When a row exists the
-- verifier signs for THIS address and refuses any other. The contract does not
-- make the recipient authorize the transaction, so the connected wallet can
-- submit the claim while the money lands somewhere else.
--
-- A separate table, not a column on `identities`, and that is the entire point:
-- RLS grants privileges per row, not per column. An UPDATE policy on
-- `identities` would let a user rewrite their own `handle`. `identities` stays
-- service-role-only forever.

create table if not exists public.payout_prefs (
  -- One per identity, not per account: two identities are two escrow pools.
  identity_id uuid primary key references public.identities (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,

  -- Shape enforced here; the base32 CHECKSUM is enforced in lib/payout.ts.
  address     text not null check (address ~ '^G[A-Z2-7]{55}$'),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.payout_prefs is
  'Where a claim on this identity must pay. When a row exists the verifier signs for this address and no other.';

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
  -- Nullable, ON DELETE SET NULL: an account can be deleted, and the record of
  -- every authorization ever signed has to outlive it. That record is what
  -- guarantees a nonce is signed at most once. What stays behind — an identity
  -- key and a public wallet address — is on chain in the claim anyway.
  profile_id        uuid references public.profiles (id) on delete set null,

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

-- ------------------------------------------------- the X handle check
--
-- GitHub answers "does this account exist" for free, from the visitor's own
-- browser, against the visitor's own rate limit. X charges $0.010 a question
-- against our credit balance and will only answer a server holding an app-only
-- token. These two tables are what let the send page ask the second question
-- without handing anybody a spend button: `x_profiles` means the same question
-- is only ever paid for once, and `x_lookups` is the meter the caps are
-- counted against. docs/API-COSTS.md has the arithmetic.

-- ------------------------------------------------------------- x_profiles

create table if not exists public.x_profiles (
  -- Normalized by lib/identity.ts before it ever gets here: lowercase, no @,
  -- no URL around it. The CHECK repeats X's own rule so a handle that could
  -- not exist never becomes a cache entry.
  handle       text primary key check (handle ~ '^[a-z0-9_]{1,15}$'),

  -- The answer being cached, and BOTH answers are worth caching. A name nobody
  -- holds is the answer that refuses a send, and re-asking it every time is
  -- how somebody drains the budget with one nonexistent handle in a loop.
  found        boolean not null,

  -- X's numeric id — the thing that does not change hands when a handle does.
  -- Null when `found` is false. Same role `identities.external_id` plays for
  -- the transfer check in lib/github.ts, and kept here so the same check
  -- becomes possible for X later without a second round of paid lookups.
  external_id  text,
  display_name text,

  fetched_at   timestamptz not null default now(),

  constraint x_profiles_id_when_found
    check ((found and external_id is not null) or (not found and external_id is null))
);

comment on table public.x_profiles is
  'Cache of paid X username lookups. A hit costs nothing; freshness is decided in lib/x.ts, not here.';

-- Deliberately NOT a TTL enforced in SQL. How stale is too stale is a product
-- decision that belongs next to the code that spends the money (lib/x.ts), and
-- an expiry baked into the schema would silently change the bill.

alter table public.x_profiles enable row level security;
-- No policies, on purpose. Same shape as `claim_nonces`: RLS on with nothing
-- granted means the anon and authenticated roles cannot read or write a single
-- row, and only the service role — which never leaves the server — can. The
-- cache is not a secret, but it is also not something a browser has any reason
-- to reach, and an endpoint somebody can read for free is an endpoint somebody
-- can use to map who we have been asked about.

-- -------------------------------------------------------------- x_lookups

create table if not exists public.x_lookups (
  id          bigint generated always as identity primary key,
  handle      text not null,

  -- HASHED, never the address itself. This table exists to bound a bill, and
  -- that job needs to tell two callers apart — it does not need to know who
  -- they are. A salted sha256 does the first without doing the second, and the
  -- salt lives in the environment, so the table alone cannot be turned back
  -- into a list of who looked up whom.
  ip_hash     text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  wallet_hash text not null check (wallet_hash ~ '^[0-9a-f]{64}$'),

  created_at  timestamptz not null default now()
);

comment on table public.x_lookups is
  'One row per PAID X lookup — cache hits write nothing. Count the rows in a month and you have the bill.';

-- The three questions x_lookup_claim asks, all of them "how many rows since a
-- point in time". One index answers all three.
create index if not exists x_lookups_created_idx
  on public.x_lookups (created_at desc);

alter table public.x_lookups enable row level security;
-- No policies. As above.

-- --------------------------------------------------------- x_lookup_claim
--
-- Ask permission and record the spend in one statement.
--
-- Split into a read then a write, two requests arriving together would both
-- read a count below the cap and both spend. One function closes that, and it
-- also means the route cannot get the order wrong: there is no way to call
-- this and receive an 'ok' that was not written down.
--
-- Returns one of:
--   ok      go ahead, and a row has been written for it
--   ip      this address has spent its window
--   wallet  this wallet has spent its window
--   global  the deployment has spent its month
--
-- The order of the checks is the order of blame, cheapest excuse last: the
-- monthly cap is checked first because when it is reached nobody gets a
-- lookup, and telling one caller "you are over your limit" when the truth is
-- "the site is over its budget" would send them off to fix the wrong thing.

create or replace function public.x_lookup_claim(
  p_handle       text,
  p_ip_hash      text,
  p_wallet_hash  text,
  p_per_caller   integer,
  p_window       interval,
  p_monthly_cap  integer
) returns text
language plpgsql
volatile
as $$
declare
  by_ip      integer;
  by_wallet  integer;
  this_month integer;
begin
  select
    count(*) filter (where ip_hash = p_ip_hash     and created_at > now() - p_window),
    count(*) filter (where wallet_hash = p_wallet_hash and created_at > now() - p_window),
    count(*) filter (where created_at >= date_trunc('month', now()))
  into by_ip, by_wallet, this_month
  from public.x_lookups;

  if this_month >= p_monthly_cap then return 'global'; end if;
  if by_ip      >= p_per_caller  then return 'ip';     end if;
  if by_wallet  >= p_per_caller  then return 'wallet'; end if;

  insert into public.x_lookups (handle, ip_hash, wallet_hash)
  values (p_handle, p_ip_hash, p_wallet_hash);

  return 'ok';
end $$;

comment on function public.x_lookup_claim is
  'Decides and records in one step. Never returns ok without having written the row that pays for it.';

-- Callable by the service role alone. `public` includes anon and authenticated,
-- and a function that mints spending permission is not something a browser
-- should be able to invoke, however little it could do with the answer.
revoke all on function public.x_lookup_claim(text, text, text, integer, interval, integer) from public;

-- ---------------------------------------------------------------- cleanup
--
-- Nothing here has to be kept: the caps look back three hours and one month.
-- Rows older than that are history, and this table is not evidence of anything
-- the way `claim_nonces` is — no money on chain depends on it. Delete on a
-- schedule (Supabase > Database > Cron) or by hand; nothing breaks either way,
-- the table just grows.
--
--   delete from public.x_lookups where created_at < now() - interval '70 days';

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

drop trigger if exists payout_prefs_touch on public.payout_prefs;
create trigger payout_prefs_touch before update on public.payout_prefs
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

-- The same trap for the payout address, and a more expensive one: pointing a
-- payout row at somebody else's identity would have the verifier sign THEIR
-- escrow over to YOUR wallet.

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

-- --------------------------------------------------------------------- RLS
--
-- Default: nothing. Then opened up one at a time.
-- The investor side reads without logging in, so `anon` gets SELECT too — but
-- only on published cards.

alter table public.profiles     enable row level security;
alter table public.identities   enable row level security;
alter table public.cards        enable row level security;
alter table public.payout_prefs enable row level security;

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

-- payout_prefs -----------------------------------------------------------
--
-- Your own row, and nothing else — not even readable by others. Where a person
-- keeps their money is nobody's business, and a public list of payout
-- addresses is a list of addresses worth attacking.

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
  'The profile page and the directory read this. A row exists for every verified identity; has_card says whether a published card is attached.';

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
