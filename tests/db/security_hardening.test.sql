-- Tests for phase18_ai_pastor_knowledge_security migration.
-- Run only against the disposable PostgreSQL database created by tests/db/run.sh.
DO $$
DECLARE
  admin_a uuid := '00000000-0000-0000-0000-00000000000a';
  super_c uuid := '00000000-0000-0000-0000-00000000000c';
  member_m uuid := '00000000-0000-0000-0000-00000000000d';
  member_n uuid := '00000000-0000-0000-0000-00000000000f';
  protected_source uuid;
  member_conversation uuid;
  other_conversation uuid;
  n integer;
BEGIN
  -- Verify the insert guard rejects a pre-approved or production-flagged row.
  BEGIN
    INSERT INTO public.knowledge_sources
      (title, "sourceType", "licenseStatus", "rawContent", "uploaderUserId", "approvalStatus")
    VALUES ('SECURITY_TEST_INSERT_APPROVED','TEACHING','LICENSE_VERIFIED','test',admin_a,'APPROVED');
    RAISE EXCEPTION 'FAIL: direct INSERT of APPROVED source was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'SOURCE_REVIEW_REQUIRED%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.knowledge_sources
      (title, "sourceType", "licenseStatus", "rawContent", "uploaderUserId", "isCurrentProduction")
    VALUES ('SECURITY_TEST_INSERT_LIVE','TEACHING','LICENSE_VERIFIED','test',admin_a,true);
    RAISE EXCEPTION 'FAIL: direct INSERT of current-production source was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'SOURCE_REVIEW_REQUIRED%' THEN RAISE; END IF;
  END;

  SELECT id INTO protected_source FROM public.knowledge_sources
    WHERE title='by-super' AND "approvalStatus"='APPROVED' AND "isCurrentProduction"=true
    LIMIT 1;
  IF protected_source IS NULL THEN RAISE EXCEPTION 'Fixture missing approved production source by-super'; END IF;

  BEGIN
    INSERT INTO public.knowledge_chunks ("sourceId","chunkIndex",content,"charCount")
    VALUES (protected_source, 99001, 'security test chunk', 19);
    RAISE EXCEPTION 'FAIL: chunk INSERT for approved source was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'APPROVED_SOURCE_CHUNKS_IMMUTABLE%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.knowledge_chunks SET content='mutated approved chunk'
    WHERE "sourceId" = protected_source;
    RAISE EXCEPTION 'FAIL: chunk UPDATE for approved source was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'APPROVED_SOURCE_CHUNKS_IMMUTABLE%' THEN RAISE; END IF;
  END;

  INSERT INTO public.ai_pastor_conversations (id,"userId",title)
  VALUES ('10000000-0000-0000-0000-000000000001',member_m,'private member M'),
         ('10000000-0000-0000-0000-000000000002',member_n,'private member N')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.ai_pastor_messages ("conversationId",role,content)
  VALUES ('10000000-0000-0000-0000-000000000001','USER','private message M'),
         ('10000000-0000-0000-0000-000000000002','USER','private message N');

  -- Admin A and SUPER_ADMIN C must not get a standing exception to ownership.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',admin_a,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.ai_pastor_conversations WHERE "userId"=member_m;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: ADMIN can read another member conversation'; END IF;
  SELECT count(*) INTO n FROM public.ai_pastor_messages WHERE content='private message M';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: ADMIN can read another member message'; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',super_c,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.ai_pastor_conversations WHERE "userId"=member_m;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: SUPER_ADMIN can read another member conversation'; END IF;
  SELECT count(*) INTO n FROM public.ai_pastor_messages WHERE content='private message M';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: SUPER_ADMIN can read another member message'; END IF;
  RESET ROLE;

  -- A member can read their own conversation/message but not another member's.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',member_m,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.ai_pastor_conversations WHERE "userId"=member_m;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: member cannot read own conversation'; END IF;
  SELECT count(*) INTO n FROM public.ai_pastor_messages WHERE content='private message M';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: member cannot read own message'; END IF;
  SELECT count(*) INTO n FROM public.ai_pastor_messages WHERE content='private message N';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: member can read another member message'; END IF;
  RESET ROLE;

  RAISE NOTICE 'PASS: AI Pastor owner-only RLS, source insert guard, and approved chunk immutability';
END $$;
