// Route authorization smoke test: every Phase 18 admin endpoint must refuse an
// unauthenticated caller (and a caller with a garbage session cookie) with
// 401/403 and must never return 2xx or leak data. Runs against `next start`
// with placeholder env vars — no Supabase, no network, no production access.
// Authenticated non-admin / admin cases need a real auth backend and are NOT
// covered here (see the staging job in .github/workflows/ci.yml).
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const id = "00000000-0000-0000-0000-000000000001";

const routes = [
  ["GET", "/api/admin/knowledge/sources"],
  ["POST", "/api/admin/knowledge/sources"],
  ["GET", `/api/admin/knowledge/sources/${id}`],
  ["PATCH", `/api/admin/knowledge/sources/${id}`],
  ["POST", `/api/admin/knowledge/sources/${id}/submit`],
  ["POST", `/api/admin/knowledge/sources/${id}/approve`],
  ["POST", `/api/admin/knowledge/sources/${id}/reject`],
  ["POST", `/api/admin/knowledge/sources/${id}/archive`],
  ["POST", `/api/admin/knowledge/sources/${id}/restore`],
  ["GET", `/api/admin/knowledge/sources/${id}/history`],
  ["GET", `/api/admin/knowledge/sources/${id}/chunks`],
  ["POST", "/api/admin/knowledge/retrieval-test"],
  ["GET", "/api/admin/ai-pastor/translations"],
  ["POST", "/api/admin/ai-pastor/translations"],
  ["PATCH", `/api/admin/ai-pastor/translations/${id}`],
];

const variants = [
  ["no cookie", {}],
  ["garbage session cookie", { cookie: "sb-placeholder-auth-token=not-a-real-session" }],
];

let failures = 0;
for (const [method, path] of routes) {
  for (const [label, headers] of variants) {
    const init = { method, headers: { ...headers }, redirect: "manual" };
    if (method !== "GET") { init.headers["content-type"] = "application/json"; init.body = JSON.stringify({ question: "x", reason: "x", title: "x" }); }
    let status = -1, text = "";
    try { const res = await fetch(base + path, init); status = res.status; text = await res.text(); }
    catch (e) { console.error(`  FAIL ${method} ${path} (${label}): request error ${e.message}`); failures++; continue; }
    const denied = status === 401 || status === 403;
    const leaked = /"(sources|source|translations|chunks|versions|audit)"\s*:\s*[\[{]/.test(text);
    if (!denied || leaked) { console.error(`  FAIL ${method} ${path} (${label}): HTTP ${status}${leaked ? " and body looks like data" : ""}`); failures++; }
    else console.log(`  ok  ${method} ${path} (${label}) -> ${status}`);
  }
}
console.log(failures === 0 ? "\nAll admin routes deny unauthenticated callers" : `\n${failures} route authorization failures`);
process.exit(failures === 0 ? 0 : 1);
