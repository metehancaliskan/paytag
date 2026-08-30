-- ===========================================================================
-- Paytag — migration 003: the X handle check, and the meter in front of it
--
-- One feature and one ledger, and the ledger is the reason the feature can
-- exist at all.
--
-- THE PROBLEM. GitHub answers "does this account exist" for free, from the
-- visitor's own browser, against the visitor's own rate limit (see
-- docs/API-COSTS.md). X does not. X charges $0.010 per user read against our
-- credit balance, with no free allowance, and the call has to be made from our
-- server because it needs an app-only bearer token. So the same question costs
-- us nothing on one platform and real money on the other, and a send page that
-- asked it the same way on both would be a $36-an-hour hole for anybody with
-- curl.
--
-- THE ANSWER, in two tables:
--
-- 1. `x_profiles` — the cache. An X account existing is a fact that almost
--    never changes, so the second person to ask about a handle should not cost
--    anything. At realistic volume this is what makes the feature cheap; the
--    limits below are what makes the worst case survivable.
--
-- 2. `x_lookups` — one row per PAID lookup. Not per request: a request served
--    from the cache writes nothing here, because it spent nothing. That makes
--    this table a literal bill — count the rows this month and multiply by a
--    cent — and it is what the caps are counted against.
--
-- The decision and the record are one function, `x_lookup_claim`, and the
-- order inside it is deliberate: the row is written BEFORE the caller goes to
-- X. The same discipline as `claim_nonces` in schema.sql — a crash must never
-- leave money spent with no record that it was. Erring towards over-counting
-- costs us a cent; erring the other way loses the only thing that bounds the
-- bill.
--
-- Safe to run more than once.
--
-- Setup:  Supabase > SQL Editor > paste this file > Run
-- ===========================================================================

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
