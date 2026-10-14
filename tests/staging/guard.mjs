// Refuses to run unless every credential belongs to the STAGING Supabase project.
export const EXPECTED_URL = "https://vsupjjbcelrcynzrlbns.supabase.co";
const EXPECTED_REF = "vsupjjbcelrcynzrlbns";
const PROD_REF = "opgcjnejfvzyqefmvrsi";

function refuse(message) {
  console.error("REFUSING TO RUN: " + message);
  process.exit(2);
}
const payload = (token) => {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString()); } catch { return null; }
};

export function enforceStagingOnly(env = process.env) {
  for (const k of ["STAGING_SUPABASE_URL", "STAGING_SUPABASE_ANON_KEY", "STAGING_SUPABASE_SERVICE_ROLE_KEY", "PREVIEW_URL"]) {
    if (!env[k]) refuse(k + " is not set");
  }
  if (env.STAGING_SUPABASE_URL !== EXPECTED_URL) refuse("STAGING_SUPABASE_URL is not exactly the staging project URL");
  const a = payload(env.STAGING_SUPABASE_ANON_KEY);
  if (!a || a.ref !== EXPECTED_REF || a.role !== "anon") refuse("the anon key does not belong to the staging project");
  const s = payload(env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  if (!s || s.ref !== EXPECTED_REF || s.role !== "service_role") refuse("the service key does not belong to the staging project");
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && v.includes(PROD_REF)) refuse("environment variable " + k + " references the production project");
  }
  if (!/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(env.PREVIEW_URL)) refuse("PREVIEW_URL is not an https vercel.app URL");
}
