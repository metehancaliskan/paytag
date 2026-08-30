-- ===========================================================================
-- Paytag — schema behaviour test
--
-- Shows not merely that schema.sql "works", but that IT REJECTS THE RIGHT
-- THINGS. Ten negative cases, each one corresponding to an attack scenario,
-- plus two retention cases that have to keep something rather than refuse it.
-- The whole thing ends in `rollback`; it never touches production data.
--
-- Cases 1-9 are constraints, so they hold against anyone, this script included.
-- Case 10 is not: nothing about the shape of `cards` stops a stranger deleting
-- your card, and `cards_delete_own` is the entire protection. Row level
-- security does not apply to the owner of the database, so that case has to
-- put the session into the `authenticated` role first and hand it a subject
-- claim — otherwise it would pass while protecting nothing.
--
-- Running it, either way — plain SQL only, no psql meta-commands:
--   Supabase:  SQL Editor -> paste -> Run. A green "All ten rejection cases
--              passed" row means every case behaved.
--   Local:     psql -f db/schema.sql && psql -f db/schema_test.sql
--
-- On Supabase, `auth.users` and `auth.uid()` already exist; when trying this
-- locally they need to be stubbed out (see the header of schema.sql).
-- ===========================================================================

begin;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Metehan'),
  ('22222222-2222-2222-2222-222222222222', 'Somebody Else');

insert into public.identities (id, profile_id, kind, handle, external_id, external_login, identity_key) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',0,'metehancaliskan','12345','MetehanCaliskan','91e23a08973aba69e14664cb9e12cc20483a4f702afdd304c8ad7424a354ffff'),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',2,'metehancaliskan','99999','MetehanCaliskan','7462d3ca2f7a62066003309a018b93907472145b9e2341e6b88fbf40fc8b86ff'),
  ('bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',0,'torvalds','777','torvalds','9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b');

do $$
begin
  -- 1. Hanging a card on somebody else's identity
  begin
    insert into public.cards (identity_id, profile_id, role, headline, summary)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','dev','Takeover attempt','This card is being hung on somebody else''s identity.');
    raise exception 'FAILED: a card could be hung on somebody else''s identity';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ a card could not be hung on somebody else''s identity (%)', sqlerrm;
  end;

  -- 2. The same (kind, handle) on two profiles
  begin
    insert into public.identities (profile_id, kind, handle, external_id, identity_key)
    values ('22222222-2222-2222-2222-222222222222',0,'metehancaliskan','555','91e23a08973aba69e14664cb9e12cc20483a4f702afdd304c8ad7424a354ffff');
    raise exception 'FAILED: the same handle was bound to two profiles';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ the same handle could not be bound to two profiles';
  end;

  -- 3. A second GitHub identity on the same profile
  begin
    insert into public.identities (profile_id, kind, handle, external_id, identity_key)
    values ('11111111-1111-1111-1111-111111111111',0,'otherhandle','888','878b3ea636f76f4f14d7296110058b68bfaab36304340a2ca43398a3f768c6d5');
    raise exception 'FAILED: a second GitHub identity was added to the same profile';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ a second GitHub identity could not be added to the same profile';
  end;

  -- 4. A card for a non-existent identity (a card without verification)
  begin
    insert into public.cards (identity_id, profile_id, role, headline, summary)
    values (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','dev','Imaginary','An attempt to write a card for an unverified identity.');
    raise exception 'FAILED: a card was written for an unverified identity';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ a card could not be written for an unverified identity';
  end;

  -- 5. A malformed identity_key
  begin
    insert into public.identities (profile_id, kind, handle, external_id, identity_key)
    values ('22222222-2222-2222-2222-222222222222',2,'torvalds','778','ZZZZ');
    raise exception 'FAILED: a malformed identity_key was accepted';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ a malformed identity_key was rejected';
  end;

  -- 6. An uppercase handle
  begin
    insert into public.identities (profile_id, kind, handle, external_id, identity_key)
    values ('22222222-2222-2222-2222-222222222222',2,'Torvalds','779','9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b');
    raise exception 'FAILED: a non-normalized handle was accepted';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ a non-normalized handle was rejected';
  end;

  -- 7. A payout address on somebody else's identity.
  --    The expensive one: if this got through, the verifier would sign that
  --    person's escrow over to this wallet.
  begin
    insert into public.payout_prefs (identity_id, profile_id, address)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
            'GDIPFNUNDF4COU5J3PJ7MKRXXSDFZ3EEDAVX34U2GDHXTPNNG4L76LPV');
    raise exception 'FAILED: a payout address was bound to somebody else''s identity';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ a payout address could not be bound to somebody else''s identity';
  end;

  -- 8. A malformed payout address. Lowercase is not strkey, and an address
  --    that cannot exist would send a claim into a transaction that fails.
  begin
    insert into public.payout_prefs (identity_id, profile_id, address)
    values ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
            'gdipfnundf4cou5j3pj7mkrxxsdfz3eedavx34u2gdhxtpnng4l76lpv');
    raise exception 'FAILED: a malformed payout address was accepted';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ a malformed payout address was rejected';
  end;

  -- 9. Two payout addresses for one identity. The second must replace the
  --    first, never sit beside it — two destinations for one escrow is a
  --    question nobody can answer.
  begin
    insert into public.payout_prefs (identity_id, profile_id, address) values
      ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
       'GDIPFNUNDF4COU5J3PJ7MKRXXSDFZ3EEDAVX34U2GDHXTPNNG4L76LPV'),
      ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
       'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H');
    raise exception 'FAILED: one identity took two payout addresses';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '✅ one identity could not take two payout addresses';
  end;
end $$;

-- Retention, not rejection: deleting an account must NOT take the record of
-- the claim authorizations signed for it. That record is what guarantees the
-- verifier signs a nonce at most once, and it is the only trace an incident
-- could be reconstructed from.
do $$
declare
  left_behind integer;
  orphaned    integer;
begin
  insert into public.claim_nonces (nonce, profile_id, identity_key, recipient, expires_at_ledger)
  values (repeat('ab', 32), '22222222-2222-2222-2222-222222222222',
          '9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b',
          'GDIPFNUNDF4COU5J3PJ7MKRXXSDFZ3EEDAVX34U2GDHXTPNNG4L76LPV', 42);

  delete from public.profiles where id = '22222222-2222-2222-2222-222222222222';

  select count(*) into left_behind
  from public.claim_nonces where nonce = repeat('ab', 32);
  if left_behind <> 1 then
    raise exception 'FAILED: deleting the account took the nonce record with it';
  end if;

  select count(*) into orphaned
  from public.claim_nonces where nonce = repeat('ab', 32) and profile_id is null;
  if orphaned <> 1 then
    raise exception 'FAILED: the nonce record still points at a deleted profile';
  end if;

  -- And the account itself really is gone, cards and identities included.
  if exists (select 1 from public.identities
             where profile_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FAILED: identities survived the account deletion';
  end if;

  raise notice '✅ deleting an account frees the handle and keeps the nonce record (profile_id null)';
end $$;

-- Happy path: two identities of the same person, two cards
insert into public.cards (identity_id, profile_id, role, headline, summary, ecosystems, published) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','dev','Soroban contracts','I write escrow contracts on Stellar, in Rust and TypeScript.', array['stellar','soroban'], true),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','shiller','Ecosystem content','I produce Turkish-language content about the Stellar ecosystem and organize events.', array['stellar'], true);

do $$ begin raise notice '=== the public_cards view ==='; end $$;
select kind, handle, headline, linked_identities from public.public_cards order by kind;

-- A payout address on the same identity, so the next case can show that
-- deleting a card leaves it standing. That is the promise the confirmation in
-- Settings makes to the reader, and this is where it is actually checked.
insert into public.payout_prefs (identity_id, profile_id, address) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'GDIPFNUNDF4COU5J3PJ7MKRXXSDFZ3EEDAVX34U2GDHXTPNNG4L76LPV');

-- 10. Deleting somebody else's card.
--
--     Unlike every case above it, this one has no constraint behind it: the
--     statement is perfectly well formed and the table would take it. What
--     refuses it is `cards_delete_own`, and a policy only exists for a session
--     that is subject to it — which is why the role is switched here. Run this
--     block without the two SET LOCALs and it passes while proving nothing,
--     because the database owner bypasses row level security.
insert into auth.users (id) values ('33333333-3333-3333-3333-333333333333');
insert into public.profiles (id, display_name) values
  ('33333333-3333-3333-3333-333333333333', 'A Stranger');

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';

do $$
declare removed integer;
begin
  delete from public.cards
   where identity_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics removed = row_count;

  -- No exception is raised: a delete blocked by row level security simply
  -- matches nothing. Zero rows IS the refusal, and it is the only signal
  -- there is, which is exactly why this needs its own case.
  if removed <> 0 then
    raise exception 'FAILED: a stranger deleted somebody else''s card';
  end if;
  raise notice '✅ a stranger could not delete somebody else''s card';
end $$;

-- Retention, again: the owner deleting their own card must take the card and
-- nothing else. The handle stays verified and the payout address stays set —
-- if either went with it, deleting a description would quietly cost somebody
-- their claim route.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

do $$
declare removed integer;
begin
  delete from public.cards
   where identity_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics removed = row_count;

  if removed <> 1 then
    raise exception 'FAILED: the owner could not delete their own card';
  end if;
  if not exists (select 1 from public.identities
                  where id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAILED: deleting a card took the verified identity with it';
  end if;
  if not exists (select 1 from public.payout_prefs
                  where identity_id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAILED: deleting a card took the payout address with it';
  end if;
  -- And only that one card: the other handle's card is a separate row and a
  -- separate decision.
  if not exists (select 1 from public.cards
                  where identity_id = 'aaaaaaaa-0000-0000-0000-000000000002') then
    raise exception 'FAILED: deleting one card took the other one with it';
  end if;

  raise notice '✅ deleting a card leaves the identity, the payout address and the other card standing';
end $$;

reset role;

rollback;

-- Nothing above this line survived the rollback. This last row exists so the
-- run has a visible verdict: any failed case raises an exception and aborts the
-- script, so reaching this statement at all is the pass condition.
select 'All ten rejection cases passed. Nothing was left behind.' as result;
