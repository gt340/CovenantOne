-- Phase 18 database tests. Run AFTER schema_fixture.sql and the self-approval
-- migration. Any failed assertion raises and, with ON_ERROR_STOP, fails CI.
-- Runs as the connecting (super)user; RLS tests use SET LOCAL ROLE authenticated.

DO $$
DECLARE
  admin_a uuid := '00000000-0000-0000-0000-00000000000a';   -- author
  admin_b uuid := '00000000-0000-0000-0000-00000000000b';   -- second administrator
  super_c uuid := '00000000-0000-0000-0000-00000000000c';
  member_m uuid := '00000000-0000-0000-0000-00000000000d';
  safety_s uuid := '00000000-0000-0000-0000-00000000000e';
  member_n uuid := '00000000-0000-0000-0000-00000000000f';
  sid uuid; sid2 uuid; lid uuid; n int; titles text; msg text; r timestamptz;
BEGIN
  INSERT INTO users(id, role) VALUES (admin_a,'ADMIN'),(admin_b,'ADMIN'),(super_c,'SUPER_ADMIN'),(member_m,'MEMBER'),(safety_s,'SAFETY_MODERATOR'),(member_n,'MEMBER');

  ----------------------------------------------------------------- helper source factory
  -- Each source starts DRAFT -> UNDER_REVIEW, authored by admin_a.
  CREATE TEMP TABLE t_src(label text PRIMARY KEY, id uuid) ON COMMIT DROP;

  -- 1. SELF-APPROVAL BLOCKED (author == approver)
  INSERT INTO knowledge_sources(title,"sourceType","licenseStatus","rawContent","uploaderUserId") VALUES ('self','TEACHING','LICENSE_VERIFIED','zyxq self',admin_a) RETURNING id INTO sid;
  INSERT INTO knowledge_chunks("sourceId","chunkIndex",content,"charCount") VALUES (sid,0,'zyxq self approval chunk',10);
  UPDATE knowledge_sources SET "approvalStatus"='UNDER_REVIEW' WHERE id=sid;
  BEGIN
    UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=admin_a WHERE id=sid;
    RAISE EXCEPTION 'FAIL: uploader self-approval was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'SELF_APPROVAL_FORBIDDEN%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  uploader self-approval blocked by the database';

  -- 2. DIRECT BYPASS: approval with no reviewer recorded
  BEGIN
    UPDATE knowledge_sources SET "approvalStatus"='APPROVED' WHERE id=sid;
    RAISE EXCEPTION 'FAIL: approval without a reviewer was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'REVIEWER_REQUIRED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  approval without a recorded reviewer blocked (direct-update bypass)';

  -- 3. UNAUTHORIZED approver (member, safety moderator, nonexistent user)
  FOREACH msg IN ARRAY ARRAY[member_m::text, safety_s::text] LOOP
    BEGIN
      UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=msg::uuid WHERE id=sid;
      RAISE EXCEPTION 'FAIL: non-admin approver was allowed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'REVIEWER_NOT_AUTHORIZED%' THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE NOTICE 'ok  non-admin reviewers (MEMBER, SAFETY_MODERATOR) cannot approve';

  -- 4. Still nothing live after all the failed attempts
  IF (SELECT "isCurrentProduction" FROM knowledge_sources WHERE id=sid) THEN RAISE EXCEPTION 'FAIL: source went live despite blocked approvals'; END IF;
  IF (SELECT count(*) FROM search_approved_knowledge('zyxq', 10, true)) <> 0 THEN RAISE EXCEPTION 'FAIL: blocked source is retrievable'; END IF;
  RAISE NOTICE 'ok  blocked approvals leave the source out of retrieval';

  -- 5. VALID approval by a different administrator, and by a SUPER_ADMIN
  UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=admin_b WHERE id=sid;
  IF NOT (SELECT "isCurrentProduction" AND "reviewedAt" IS NOT NULL AND "reviewedByUserId"=admin_b FROM knowledge_sources WHERE id=sid) THEN RAISE EXCEPTION 'FAIL: valid approval did not take effect'; END IF;
  RAISE NOTICE 'ok  approval by a different ADMIN succeeds and records the reviewer';
  INSERT INTO knowledge_sources(title,"sourceType","licenseStatus","rawContent","uploaderUserId") VALUES ('by-super','TEACHING','LICENSE_VERIFIED','zyxq super',admin_a) RETURNING id INTO sid2;
  UPDATE knowledge_sources SET "approvalStatus"='UNDER_REVIEW' WHERE id=sid2;
  UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=super_c WHERE id=sid2;
  RAISE NOTICE 'ok  approval by SUPER_ADMIN succeeds';

  ----------------------------------------------------------------- retrieval filtering
  -- Fixtures: one source per status/licence/visibility case. Approval uses admin_b.
  INSERT INTO knowledge_sources(title,"sourceType","licenseStatus",visibility,"rawContent","uploaderUserId") VALUES
    ('R_DRAFT','TEACHING','LICENSE_VERIFIED','MEMBER_FACING','x',admin_a),
    ('R_REVIEW','TEACHING','LICENSE_VERIFIED','MEMBER_FACING','x',admin_a),
    ('R_REJECTED','TEACHING','LICENSE_VERIFIED','MEMBER_FACING','x',admin_a),
    ('R_ARCHIVED','TEACHING','LICENSE_VERIFIED','MEMBER_FACING','x',admin_a),
    ('R_OK','TEACHING','LICENSE_VERIFIED','MEMBER_FACING','x',admin_a),
    ('R_LICREVIEW','TEACHING','LICENSE_REQUIRES_REVIEW','MEMBER_FACING','x',admin_a),
    ('R_RESTRICTED','TEACHING','RESTRICTED','MEMBER_FACING','x',admin_a),
    ('R_UNKNOWN','TEACHING','LICENSE_UNKNOWN','MEMBER_FACING','x',admin_a),
    ('R_ADMINONLY','TEACHING','LICENSE_VERIFIED','ADMIN_ONLY','x',admin_a);
  INSERT INTO knowledge_chunks("sourceId","chunkIndex",content,"charCount") SELECT id,0,'qwvbn retrieval '||title,20 FROM knowledge_sources WHERE title LIKE 'R\_%';
  UPDATE knowledge_sources SET "approvalStatus"='UNDER_REVIEW' WHERE title LIKE 'R\_%' AND title <> 'R_DRAFT';
  UPDATE knowledge_sources SET "approvalStatus"='REJECTED' WHERE title='R_REJECTED';
  UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=admin_b WHERE title IN ('R_ARCHIVED','R_OK','R_LICREVIEW','R_RESTRICTED','R_UNKNOWN','R_ADMINONLY');
  UPDATE knowledge_sources SET "approvalStatus"='ARCHIVED' WHERE title='R_ARCHIVED';

  SELECT string_agg(title, ',' ORDER BY title) INTO titles FROM search_approved_knowledge('qwvbn', 10, false);
  IF titles IS DISTINCT FROM 'R_OK' THEN RAISE EXCEPTION 'FAIL: member retrieval returned %, expected only R_OK', titles; END IF;
  RAISE NOTICE 'ok  member retrieval: DRAFT, UNDER_REVIEW, REJECTED, ARCHIVED, licence-unresolved and ADMIN_ONLY sources are all excluded; APPROVED is included';
  SELECT string_agg(title, ',' ORDER BY title) INTO titles FROM search_approved_knowledge('qwvbn', 10, true);
  IF titles IS DISTINCT FROM 'R_ADMINONLY,R_OK' THEN RAISE EXCEPTION 'FAIL: admin-test retrieval returned %', titles; END IF;
  RAISE NOTICE 'ok  admin-only source visible only when the admin test flag is set';

  ----------------------------------------------------------------- lifecycle: archive / restore / versioning
  IF (SELECT "archivedAt" IS NULL OR "isCurrentProduction" FROM knowledge_sources WHERE title='R_ARCHIVED') THEN RAISE EXCEPTION 'FAIL: archive did not set archivedAt / clear production flag'; END IF;
  UPDATE knowledge_sources SET "approvalStatus"='DRAFT', "archivedAt"=NULL WHERE title='R_ARCHIVED';
  IF EXISTS (SELECT 1 FROM search_approved_knowledge('qwvbn', 10, true) WHERE title='R_ARCHIVED') THEN RAISE EXCEPTION 'FAIL: restored source is retrievable without re-approval'; END IF;
  RAISE NOTICE 'ok  archive removes from production; restore returns to DRAFT and stays out of retrieval';

  INSERT INTO knowledge_sources(title,"sourceType","licenseStatus","rawContent","uploaderUserId") VALUES ('V1','TEACHING','LICENSE_VERIFIED','x',admin_a) RETURNING id, "lineageId" INTO sid, lid;
  INSERT INTO knowledge_chunks("sourceId","chunkIndex",content,"charCount") VALUES (sid,0,'lmnop version one',10);
  UPDATE knowledge_sources SET "approvalStatus"='UNDER_REVIEW' WHERE id=sid;
  UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=admin_b WHERE id=sid;
  INSERT INTO knowledge_sources("lineageId",version,"supersedesId",title,"sourceType","licenseStatus","rawContent","uploaderUserId") VALUES (lid,2,sid,'V2','TEACHING','LICENSE_VERIFIED','x',admin_b) RETURNING id INTO sid2;
  INSERT INTO knowledge_chunks("sourceId","chunkIndex",content,"charCount") VALUES (sid2,0,'lmnop version two',10);
  IF NOT (SELECT "isCurrentProduction" FROM knowledge_sources WHERE id=sid) THEN RAISE EXCEPTION 'FAIL: a draft v2 displaced live v1'; END IF;
  UPDATE knowledge_sources SET "approvalStatus"='UNDER_REVIEW' WHERE id=sid2;
  BEGIN  -- v2 was authored by admin_b, so admin_b cannot approve it
    UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=admin_b WHERE id=sid2;
    RAISE EXCEPTION 'FAIL: author approved their own new version';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'SELF_APPROVAL_FORBIDDEN%' THEN RAISE; END IF; END;
  UPDATE knowledge_sources SET "approvalStatus"='APPROVED', "reviewedByUserId"=admin_a WHERE id=sid2;
  IF (SELECT "isCurrentProduction" FROM knowledge_sources WHERE id=sid) OR NOT (SELECT "isCurrentProduction" FROM knowledge_sources WHERE id=sid2) THEN RAISE EXCEPTION 'FAIL: version lineage did not swap production versions'; END IF;
  SELECT string_agg(title, ',') INTO titles FROM search_approved_knowledge('lmnop', 10, false);
  IF titles IS DISTINCT FROM 'V2' THEN RAISE EXCEPTION 'FAIL: retrieval after v2 approval returned %', titles; END IF;
  RAISE NOTICE 'ok  versioning: draft v2 does not displace v1; author cannot approve v2; approved v2 replaces v1 in retrieval and lineage';

  ----------------------------------------------------------------- RLS / memory isolation
  INSERT INTO ai_pastor_memory("userId", content) VALUES (member_m,'m-private'),(member_n,'n-private');
  INSERT INTO ai_pastor_conversations("userId", title) VALUES (member_m,'m-conv'),(member_n,'n-conv');
  INSERT INTO ai_pastor_retrieval_events("userId", origin, "questionHash") VALUES (member_m,'CHAT','h');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', member_m, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM knowledge_sources; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: member can read % knowledge_sources', n; END IF;
  SELECT count(*) INTO n FROM knowledge_chunks; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: member can read % knowledge_chunks', n; END IF;
  SELECT count(*) INTO n FROM ai_pastor_retrieval_events; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: member can read retrieval events'; END IF;
  SELECT count(*) INTO n FROM ai_pastor_memory; IF n <> 1 THEN RAISE EXCEPTION 'FAIL: member sees % memory rows, expected only their own', n; END IF;
  SELECT count(*) INTO n FROM ai_pastor_memory WHERE "userId" = member_n; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: member can read another member memory'; END IF;
  SELECT count(*) INTO n FROM ai_pastor_conversations WHERE "userId" <> member_m; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: member can read another member conversations'; END IF;
  UPDATE knowledge_sources SET "approvalStatus"='APPROVED' WHERE title='R_REVIEW'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: member updated % knowledge_sources rows', n; END IF;
  BEGIN
    PERFORM * FROM search_approved_knowledge('qwvbn', 5, false);
    RAISE EXCEPTION 'FAIL: member can call the retrieval function directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'ok  RLS: member cannot read knowledge/retrieval data, cannot read other members memory or conversations, cannot approve, cannot call the search function';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM knowledge_sources; IF n = 0 THEN RAISE EXCEPTION 'FAIL: admin cannot read knowledge_sources'; END IF;
  SELECT count(*) INTO n FROM ai_pastor_memory; IF n <> 0 THEN RAISE EXCEPTION 'FAIL: admin can read member private memory (% rows)', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok  RLS: admin can manage knowledge but cannot read members private memory';

  RAISE NOTICE 'ALL DATABASE TESTS PASSED';
END $$;
