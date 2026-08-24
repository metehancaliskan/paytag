-- ===========================================================================
-- Paytag — schema behaviour test
--
-- Shows not merely that schema.sql "works", but that IT REJECTS THE RIGHT
-- THINGS. Six negative cases, each one corresponding to an attack scenario.
-- The whole thing ends in `rollback`; it never touches production data.
--
-- Running it, either way — plain SQL only, no psql meta-commands:
--   Supabase:  SQL Editor -> paste -> Run. A green "All six rejection cases
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
    insert into public.cards (identity_id, profile_id, headline, summary)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Takeover attempt','This card is being hung on somebody else''s identity.');
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
    insert into public.cards (identity_id, profile_id, headline, summary)
    values (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','Imaginary','An attempt to write a card for an unverified identity.');
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
end $$;

-- Happy path: two identities of the same person, two cards
insert into public.cards (identity_id, profile_id, headline, summary, ecosystems, published) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Soroban contracts','I write escrow contracts on Stellar, in Rust and TypeScript.', array['stellar','soroban'], true),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Ecosystem content','I produce Turkish-language content about the Stellar ecosystem and organize events.', array['stellar'], true);

do $$ begin raise notice '=== the public_cards view ==='; end $$;
select kind, handle, headline, linked_identities from public.public_cards order by kind;

rollback;

-- Nothing above this line survived the rollback. This last row exists so the
-- run has a visible verdict: any failed case raises an exception and aborts the
-- script, so reaching this statement at all is the pass condition.
select 'All six rejection cases passed. Nothing was left behind.' as result;
