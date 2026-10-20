// Logged-in route tests for Phase 18 approval governance. STAGING ONLY (see guard.mjs).
// Secrets are read from the environment and never printed. Evidence rows go to public.route_test_results on staging.
import { randomUUID } from "node:crypto";
import { enforceStagingOnly } from "./guard.mjs";

enforceStagingOnly(); // exits with code 2 before any network call if anything is not staging

const { createClient } = await import("@supabase/supabase-js");
const { createServerClient } = await import("@supabase/ssr");

const SB = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.PREVIEW_URL.replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
const RUN = process.env.GITHUB_RUN_ID ? "gh" + process.env.GITHUB_RUN_ID : randomUUID().slice(0, 8);
const T0 = new Date(Date.now() - 60000).toISOString();
const adm = createClient(SB, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
let failures = 0;
function rec(name, expected, actual, passed, detail = {}) {
  if (!passed) failures++;
  results.push({ run_id: RUN, seq: results.length + 1, name, expected: String(expected), actual: String(actual), passed: !!passed, detail });
  console.log((passed ? "PASS" : "FAIL") + " | " + name + " | expected " + expected + " | actual " + actual);
}
class Abort extends Error {}
const must = async (p, what) => { const { data, error } = await p; if (error) throw new Error(what + ": " + error.message); return data; };

async function call(method, path, { cookie, body } = {}) {
  const headers = { accept: "application/json" };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (BYPASS) headers["x-vercel-protection-bypass"] = BYPASS;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, snippet: text.slice(0, 160), location: res.headers.get("location") };
}
async function rest(method, pathQ, token, body) {
  const res = await fetch(SB + "/rest/v1/" + pathQ, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { apikey: ANON, authorization: "Bearer " + (token || ANON), "content-type": "application/json", prefer: "return=representation" },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 300) };
}

const EMAILS = {
  A: ["rt-admin-a@covenantone-staging.invalid", "ADMIN"], B: ["rt-admin-b@covenantone-staging.invalid", "ADMIN"],
  C: ["rt-super-c@covenantone-staging.invalid", "SUPER_ADMIN"], S: ["rt-safety-s@covenantone-staging.invalid", "SAFETY_MODERATOR"],
  M: ["rt-member-m@covenantone-staging.invalid", "MEMBER"], N: ["rt-member-n@covenantone-staging.invalid", "MEMBER"],
};
const acct = {};
async function loginAll() {
  const { data } = await adm.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const [k, [email, role]] of Object.entries(EMAILS)) {
    const u = data.users.find((x) => x.email === email);
    if (!u) throw new Abort("test account missing: " + k);
    const prof = await must(adm.from("users").select("role,status").eq("id", u.id).single(), "profile " + k);
    if (prof.role !== role || prof.status !== "ACTIVE") throw new Abort("test account " + k + " has wrong role/status");
    // Generate a one-time magic-link token for this staging test identity. Do not
    // overwrite its password: test runs must not mutate account credentials.
    const { data: link, error: linkError } = await adm.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError || !link?.properties?.hashed_token) throw new Abort("magic-link generation failed for " + k);
    const jar = new Map();
    const sb = createServerClient(SB, ANON, { cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    } });
    const { data: s, error } = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (error || !s.session) throw new Abort("magic-link verification failed for " + k + (error ? ": " + error.message : ""));
    acct[k] = { id: u.id, role, token: s.session.access_token, cookie: [...jar].map(([n, v]) => n + "=" + v).join("; ") };
  }
}

const BODY_TEXT = "Disposable route-test content used to verify approval governance on staging. It has no theological purpose. ".repeat(6);
async function mkSource(tag, authorId, { status = "UNDER_REVIEW", license = "LICENSE_VERIFIED" } = {}) {
  const src = await must(adm.from("knowledge_sources").insert({
    title: "ROUTETEST-" + RUN + "-" + tag, sourceType: "TEACHING", licenseStatus: license, trustLevel: "UNVERIFIED",
    rawContent: BODY_TEXT, contentCharCount: BODY_TEXT.length, approvalStatus: status, uploaderUserId: authorId,
  }).select().single(), "fixture " + tag);
  await must(adm.from("knowledge_chunks").insert({ sourceId: src.id, chunkIndex: 0, content: BODY_TEXT.slice(0, 300), charCount: 300 }), "chunk " + tag);
  return src;
}
const getSrc = (id) => must(adm.from("knowledge_sources").select('"approvalStatus", "isCurrentProduction", "reviewedByUserId", "licenseStatus", "uploaderUserId"').eq("id", id).single(), "read source");
const audit = (id, action) => must(adm.from("audit_logs").select('"actorUserId", action, metadata, "createdAt"').eq("targetId", id).eq("action", action).gte("createdAt", T0).order("createdAt"), "audit");
const unchanged = (s) => s.approvalStatus === "UNDER_REVIEW" && !s.isCurrentProduction && !s.reviewedByUserId;

const created = []; // source ids for cleanup\nconst createdConversations = [];\nconst createdMessages = [];\nconst createdMemories = [];
async function main() {
  await loginAll();
  const A = acct.A, B = acct.B, C = acct.C, S = acct.S, M = acct.M, N = acct.N;

  // ---- Preflight: prove the preview is wired to STAGING (URL, anon key AND service key) ----
  const marker = await mkSource("PREFLIGHT", A.id, { status: "DRAFT" }); created.push(marker.id);
  const p0 = await call("GET", "/api/admin/knowledge/sources");
  if (p0.status !== 401 || !p0.json) { rec("P0 app answers logged-out request with JSON 401", "401 JSON", p0.status + (p0.json ? " json" : " non-json (Vercel protection page?)"), false, { snippet: p0.snippet }); throw new Abort("preview not reachable by the app"); }
  rec("P0 app answers logged-out request with JSON 401", "401 JSON", "401 json", true);
  const p1 = await call("GET", "/api/admin/knowledge/sources?search=ROUTETEST-" + RUN + "-PREFLIGHT", { cookie: A.cookie });
  const sawMarker = p1.status === 200 && (p1.json?.sources || []).some((x) => x.id === marker.id);
  rec("P1 preview is backed by STAGING (staging admin session accepted AND staging-only marker row visible)", "200 + marker", p1.status + (sawMarker ? " marker seen" : " marker NOT seen"), sawMarker, { snippet: sawMarker ? "" : p1.snippet });
  if (!sawMarker) throw new Abort("preview is not using staging credentials");

  const S1 = await mkSource("S1", A.id); created.push(S1.id);
  const S2 = await mkSource("S2", A.id); created.push(S2.id);
  const S5 = await mkSource("S5", A.id); created.push(S5.id);

  // ---- T1 logged-out ----
  for (const [m, p, b] of [
    ["GET", "/api/admin/knowledge/sources"], ["POST", "/api/admin/knowledge/sources", { title: "x" }],
    ["GET", "/api/admin/knowledge/sources/" + S1.id], ["PATCH", "/api/admin/knowledge/sources/" + S1.id, { title: "x" }],
    ["POST", "/api/admin/knowledge/sources/" + S1.id + "/submit"], ["POST", "/api/admin/knowledge/sources/" + S1.id + "/approve"],
    ["POST", "/api/admin/knowledge/retrieval-test", { question: "x" }], ["GET", "/api/admin/ai-pastor/translations"],
  ]) { const r = await call(m, p, { body: b }); rec("T1 logged-out " + m + " " + p.replace(S1.id, "<S1>"), 401, r.status, r.status === 401, { snippet: r.snippet }); }
  rec("T1 S1 unchanged after logged-out attempts", "UNDER_REVIEW", (await getSrc(S1.id)).approvalStatus, unchanged(await getSrc(S1.id)));

  // ---- T2 MEMBER and SAFETY_MODERATOR ----
  for (const [label, who] of [["MEMBER m", M], ["MEMBER n", N], ["SAFETY_MODERATOR", S]]) {
    for (const [m, p, b] of [
      ["POST", "/api/admin/knowledge/sources/" + S1.id + "/approve"], ["GET", "/api/admin/knowledge/sources"],
      ["POST", "/api/admin/knowledge/sources", { title: "x", sourceType: "TEACHING", rawContent: BODY_TEXT }],
      ["PATCH", "/api/admin/knowledge/sources/" + S1.id, { title: "hijack" }], ["GET", "/api/admin/knowledge/sources/" + S1.id],
    ]) { const r = await call(m, p, { cookie: who.cookie, body: b }); rec("T2 " + label + " " + m + " " + p.replace(S1.id, "<S1>"), 403, r.status, r.status === 403, { snippet: r.snippet }); }
  }
  const s1a = await getSrc(S1.id);
  rec("T2 S1 still UNDER_REVIEW, not production, no reviewer", "unchanged", JSON.stringify(s1a), unchanged(s1a));

  // ---- T3 author cannot approve own source ----
  const self = await call("POST", "/api/admin/knowledge/sources/" + S1.id + "/approve", { cookie: A.cookie });
  rec("T3 author ADMIN approves own source", "403 SELF_APPROVAL_FORBIDDEN", self.status + " " + (self.json?.code || ""), self.status === 403 && self.json?.code === "SELF_APPROVAL_FORBIDDEN");
  const forged = await call("POST", "/api/admin/knowledge/sources/" + S5.id + "/approve", { cookie: A.cookie, body: { reviewedByUserId: B.id, actorId: B.id } });
  rec("T3 author tries to forge another reviewer in request body", "403 SELF_APPROVAL_FORBIDDEN", forged.status + " " + (forged.json?.code || ""), forged.status === 403 && forged.json?.code === "SELF_APPROVAL_FORBIDDEN");
  rec("T3 S1 and S5 still unchanged", "unchanged", "", unchanged(await getSrc(S1.id)) && unchanged(await getSrc(S5.id)));
  const dn = await audit(S1.id, "KNOWLEDGE_SOURCE_APPROVAL_DENIED");
  rec("T3 denied self-approval is audit-logged with actor and timestamp", "1 row, actor=author", dn.length + " row(s)", dn.length >= 1 && dn[0].actorUserId === A.id, { actor_ok: dn[0]?.actorUserId === A.id, at: dn[0]?.createdAt, metadata: dn[0]?.metadata });

  // ---- T4 different authorized admins approve ----
  const okB = await call("POST", "/api/admin/knowledge/sources/" + S1.id + "/approve", { cookie: B.cookie });
  const s1b = await getSrc(S1.id);
  rec("T4 different ADMIN approves S1", "200 APPROVED reviewer=B production", okB.status + " " + s1b.approvalStatus, okB.status === 200 && s1b.approvalStatus === "APPROVED" && s1b.reviewedByUserId === B.id && s1b.isCurrentProduction === true);
  const okC = await call("POST", "/api/admin/knowledge/sources/" + S2.id + "/approve", { cookie: C.cookie });
  const s2b = await getSrc(S2.id);
  rec("T4 SUPER_ADMIN approves S2", "200 APPROVED reviewer=C production", okC.status + " " + s2b.approvalStatus, okC.status === 200 && s2b.approvalStatus === "APPROVED" && s2b.reviewedByUserId === C.id && s2b.isCurrentProduction === true);
  const again = await call("POST", "/api/admin/knowledge/sources/" + S1.id + "/approve", { cookie: C.cookie });
  rec("T4 re-approving an already approved source is refused", 409, again.status, again.status === 409, { code: again.json?.code });
  const ap = await audit(S1.id, "KNOWLEDGE_SOURCE_APPROVED");
  rec("T4 approval is audit-logged with reviewer and timestamp", "1 row, actor=B", ap.length + " row(s)", ap.length === 1 && ap[0].actorUserId === B.id, { at: ap[0]?.createdAt, metadata: ap[0]?.metadata });
  const found = await must(adm.rpc("search_approved_knowledge", { p_query: "disposable route-test content approval governance", p_limit: 10, p_include_admin_only: false }), "retrieval");
  const ids = (found || []).map((x) => x.sourceId);
  rec("T4 retrieval returns approved S1+S2 and NOT unapproved S5", "S1,S2 yes; S5 no", "S1=" + ids.includes(S1.id) + " S2=" + ids.includes(S2.id) + " S5=" + ids.includes(S5.id), ids.includes(S1.id) && ids.includes(S2.id) && !ids.includes(S5.id));

  // ---- T5 licence-change audit ----
  const mk = await call("POST", "/api/admin/knowledge/sources", { cookie: A.cookie, body: { title: "ROUTETEST-" + RUN + "-S3", sourceType: "TEACHING", rawContent: BODY_TEXT } });
  const S3id = mk.json?.source?.id; if (S3id) created.push(S3id);
  rec("T5 admin A creates source via route", "201", mk.status, mk.status === 201 && !!S3id, { snippet: mk.status === 201 ? "" : mk.snippet });
  const l1 = await call("PATCH", "/api/admin/knowledge/sources/" + S3id, { cookie: A.cookie, body: { licenseStatus: "LICENSE_VERIFIED" } });
  const a1 = await audit(S3id, "KNOWLEDGE_LICENSE_STATUS_CHANGED");
  const m1 = JSON.stringify(a1[0]?.metadata || {});
  rec("T5 licence change #1 by A is audit-logged (actor, timestamp, from/to)", "200 + 1 row actor=A", l1.status + " + " + a1.length + " row(s)", l1.status === 200 && a1.length === 1 && a1[0].actorUserId === A.id && m1.includes("LICENSE_REQUIRES_REVIEW") && m1.includes("LICENSE_VERIFIED"), { at: a1[0]?.createdAt, metadata: a1[0]?.metadata });
  const l2 = await call("PATCH", "/api/admin/knowledge/sources/" + S3id, { cookie: B.cookie, body: { licenseStatus: "RESTRICTED" } });
  const a2 = await audit(S3id, "KNOWLEDGE_LICENSE_STATUS_CHANGED");
  rec("T5 licence change #2 by B is audit-logged with actor B", "200 + 2 rows, last actor=B", l2.status + " + " + a2.length + " row(s)", l2.status === 200 && a2.length === 2 && a2[1].actorUserId === B.id, { at: a2[1]?.createdAt, metadata: a2[1]?.metadata });
  const l3 = await call("PATCH", "/api/admin/knowledge/sources/" + S3id, { cookie: M.cookie, body: { licenseStatus: "LICENSE_VERIFIED" } });
  const a3 = await audit(S3id, "KNOWLEDGE_LICENSE_STATUS_CHANGED");
  rec("T5 MEMBER cannot change licence; no audit row, licence unchanged", "403, 2 rows, RESTRICTED", l3.status + ", " + a3.length + " rows, " + (await getSrc(S3id)).licenseStatus, l3.status === 403 && a3.length === 2 && (await getSrc(S3id)).licenseStatus === "RESTRICTED");
  const cr = await audit(S3id, "KNOWLEDGE_SOURCE_CREATED");
  rec("T5 creation is audit-logged with actor A", "1 row actor=A", cr.length + " row(s)", cr.length === 1 && cr[0].actorUserId === A.id, { at: cr[0]?.createdAt });

  // ---- T6 direct API calls cannot bypass approval ----
  const ra = await rest("PATCH", "knowledge_sources?id=eq." + S5.id, M.token, { approvalStatus: "APPROVED" });
  rec("T6 MEMBER direct REST PATCH approving S5", "blocked, S5 unchanged", ra.status + " " + ra.text.slice(0, 40), (ra.status >= 400 || (Array.isArray(ra.json) && ra.json.length === 0)) && unchanged(await getSrc(S5.id)));
  const rb = await rest("GET", "knowledge_sources?select=id", M.token);
  rec("T6 MEMBER direct REST read of knowledge_sources", "0 rows", rb.status + " rows=" + (Array.isArray(rb.json) ? rb.json.length : "n/a"), Array.isArray(rb.json) && rb.json.length === 0);
  const rc = await rest("POST", "rpc/search_approved_knowledge", M.token, { p_query: "disposable", p_limit: 3, p_include_admin_only: true });
  rec("T6 MEMBER direct REST call of search function", "4xx permission denied", rc.status, rc.status >= 400 && rc.status < 500, { snippet: rc.text.slice(0, 100) });
  const rd = await rest("PATCH", "knowledge_sources?id=eq." + S5.id, A.token, { approvalStatus: "APPROVED", reviewedByUserId: A.id });
  rec("T6 author ADMIN direct REST approve with self as reviewer", "error SELF_APPROVAL_FORBIDDEN", rd.status + " " + rd.text.slice(0, 60), rd.status >= 400 && rd.text.includes("SELF_APPROVAL_FORBIDDEN") && unchanged(await getSrc(S5.id)));
  const re = await rest("PATCH", "knowledge_sources?id=eq." + S5.id, A.token, { approvalStatus: "APPROVED" });
  rec("T6 author ADMIN direct REST approve with no reviewer", "error REVIEWER_REQUIRED", re.status + " " + re.text.slice(0, 60), re.status >= 400 && re.text.includes("REVIEWER_REQUIRED") && unchanged(await getSrc(S5.id)));
  const f1 = await adm.from("knowledge_sources").update({ approvalStatus: "APPROVED", reviewedByUserId: M.id }).eq("id", S5.id);
  rec("T6 service-role update naming a MEMBER as reviewer", "REVIEWER_NOT_AUTHORIZED", f1.error?.message?.slice(0, 40) || "no error", !!f1.error?.message?.includes("REVIEWER_NOT_AUTHORIZED") && unchanged(await getSrc(S5.id)));
  const f2 = await adm.from("knowledge_sources").update({ approvalStatus: "APPROVED", reviewedByUserId: A.id }).eq("id", S5.id);
  rec("T6 service-role update naming the author as reviewer", "SELF_APPROVAL_FORBIDDEN", f2.error?.message?.slice(0, 40) || "no error", !!f2.error?.message?.includes("SELF_APPROVAL_FORBIDDEN") && unchanged(await getSrc(S5.id)));
  const ins = await rest("POST", "knowledge_sources", A.token, { title: "ROUTETEST-" + RUN + "-DIRECT-INSERT", sourceType: "TEACHING", licenseStatus: "LICENSE_VERIFIED", rawContent: BODY_TEXT, contentCharCount: BODY_TEXT.length, approvalStatus: "APPROVED", isCurrentProduction: true, uploaderUserId: A.id, reviewedByUserId: A.id });
  const insId = Array.isArray(ins.json) ? ins.json[0]?.id : null; if (insId) created.push(insId);
  rec("T6 ADMIN direct REST INSERT of a source already APPROVED+production (self-reviewed)", "rejected", ins.status + (insId ? " ROW CREATED" : " " + ins.text.slice(0, 60)), ins.status >= 400 && !insId, { snippet: ins.text.slice(0, 120) });
  const tamper = await rest("PATCH", "knowledge_chunks?sourceId=eq." + S1.id, A.token, { content: "TAMPERED-" + RUN });
  rec("T6 ADMIN direct REST edit of an APPROVED source's chunk text", "rejected", tamper.status + (Array.isArray(tamper.json) && tamper.json.length ? " " + tamper.json.length + " chunk(s) CHANGED" : " none changed"), tamper.status >= 400 || (Array.isArray(tamper.json) && tamper.json.length === 0));

  // ---- T7 privacy isolation ----
  for (const [k, who] of [["m", M], ["n", N]]) {
    const conv = await must(adm.from("ai_pastor_conversations").insert({ userId: who.id, title: "rt-private-" + RUN + "-" + k }).select().single(), "conv");
    createdConversations.push(conv.id);
    const msg = await must(adm.from("ai_pastor_messages").insert({ conversationId: conv.id, role: "USER", content: "private message " + k }).select("id").single(), "msg");
    createdMessages.push(msg.id);
    const mem = await must(adm.from("ai_pastor_memory").insert({ userId: who.id, category: "USER_PREFERENCES", key: "rt-" + RUN, value: { note: "private-" + k } }).select("id").single(), "mem");
    createdMemories.push(mem.id);
  }
  const len = (r) => (Array.isArray(r.json) ? r.json.length : "n/a");
  for (const [label, who] of [["ADMIN A", A], ["SUPER_ADMIN C", C]]) {
    const mem = await rest("GET", "ai_pastor_memory?select=id", who.token);
    rec("T7 " + label + " direct REST read of members' private memory", "0 rows", mem.status + " rows=" + len(mem), mem.status === 200 && len(mem) === 0);
    const cv = await rest("GET", "ai_pastor_conversations?select=id,title&userId=eq." + M.id, who.token);
    rec("T7 " + label + " direct REST read of a member's conversations", "0 rows", cv.status + " rows=" + len(cv), cv.status === 200 && len(cv) === 0);
    const ms = await rest("GET", "ai_pastor_messages?select=id", who.token);
    rec("T7 " + label + " direct REST read of members' messages", "0 rows", ms.status + " rows=" + len(ms), ms.status === 200 && len(ms) === 0);
  }
  const own = await rest("GET", "ai_pastor_memory?select=id", M.token);
  const other = await rest("GET", "ai_pastor_conversations?select=id&userId=eq." + N.id, M.token);
  rec("T7 MEMBER m sees own memory (1 row) and none of member n's conversations", "1 row; 0 rows", "rows=" + len(own) + "; rows=" + len(other), len(own) === 1 && len(other) === 0);
  const det = await call("GET", "/api/admin/knowledge/sources/" + S1.id, { cookie: A.cookie });
  rec("T7 admin knowledge routes expose no member private data", "no 'rt-private' in response", det.status + "", det.status === 200 && !JSON.stringify(det.json).includes("rt-private"));
}

let exitCode = 0, cleanup = {};
try { await main(); }
catch (e) { exitCode = e instanceof Abort ? 3 : 4; rec("RUN ABORTED", "completes", (e instanceof Abort ? "aborted: " : "error: ") + String(e.message).slice(0, 200), false); }
finally {
  try {
    if (created.length) {
      const auditDelete = await adm.from("audit_logs").delete().in("targetId", created);
      cleanup.auditDeleteError = auditDelete.error?.message || null;
      // Approved fixtures must first pass through the existing archive lifecycle;
      // the security trigger correctly rejects direct deletion of live production rows.
      const archive = await adm.from("knowledge_sources").update({ approvalStatus: "ARCHIVED" })
        .in("id", created).eq("approvalStatus", "APPROVED");
      cleanup.sourceArchiveError = archive.error?.message || null;
      const sourceDelete = await adm.from("knowledge_sources").delete().in("id", created);
      cleanup.sourceDeleteError = sourceDelete.error?.message || null;
    }
    // Delete only rows created by this run. Never purge all memory or conversations
    // belonging to shared test accounts.
    if (createdMessages.length) {
      const r = await adm.from("ai_pastor_messages").delete().in("id", createdMessages);
      cleanup.messagesDeleteError = r.error?.message || null;
    }
    if (createdMemories.length) {
      const r = await adm.from("ai_pastor_memory").delete().in("id", createdMemories);
      cleanup.memoriesDeleteError = r.error?.message || null;
    }
    if (createdConversations.length) {
      const r = await adm.from("ai_pastor_conversations").delete().in("id", createdConversations);
      cleanup.conversationsDeleteError = r.error?.message || null;
    }
    const left = await adm.from("knowledge_sources").select("id", { count: "exact", head: true }).like("title", "ROUTETEST-" + RUN + "-%");
    cleanup.sourcesRemaining = left.count;
    if (createdConversations.length) {
      const remaining = await adm.from("ai_pastor_conversations").select("id", { count: "exact", head: true }).in("id", createdConversations);
      cleanup.conversationsRemaining = remaining.count;
    }
    if (createdMemories.length) {
      const remaining = await adm.from("ai_pastor_memory").select("id", { count: "exact", head: true }).in("id", createdMemories);
      cleanup.memoriesRemaining = remaining.count;
    }
    if (createdMessages.length) {
      const remaining = await adm.from("ai_pastor_messages").select("id", { count: "exact", head: true }).in("id", createdMessages);
      cleanup.messagesRemaining = remaining.count;
    }
  } catch (e) { cleanup.error = String(e.message).slice(0, 120); }
  results.push({ run_id: RUN, seq: results.length + 1, name: "CLEANUP", expected: "0 run-created test rows remain; shared accounts unchanged", actual: JSON.stringify(cleanup), passed: cleanup.sourcesRemaining === 0 && (cleanup.conversationsRemaining ?? 0) === 0 && (cleanup.memoriesRemaining ?? 0) === 0 && (cleanup.messagesRemaining ?? 0) === 0 && !cleanup.error && !cleanup.auditDeleteError && !cleanup.sourceArchiveError && !cleanup.sourceDeleteError && !cleanup.messagesDeleteError && !cleanup.memoriesDeleteError && !cleanup.conversationsDeleteError, detail: cleanup });
  const ins = await adm.from("route_test_results").insert(results);
  console.log(ins.error ? "could not write results: " + ins.error.message : "results written to route_test_results (run " + RUN + ")");
  console.log(failures + " failure(s) of " + results.length + " checks");
  process.exit(exitCode || (failures ? 1 : 0));
}
