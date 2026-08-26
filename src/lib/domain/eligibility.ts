// Pure functions only — no Supabase, no Next.js, no I/O. This is what makes
// them testable offline (see tests/eligibility.test.ts) and reusable from
// both client and server code without pulling in server-only dependencies.

export const MINIMUM_AGE_YEARS = 18;

/// Mirrors the DB-level CHECK constraint (chk_member_profiles_min_age,
/// migration 0005) exactly: dateOfBirth <= today - 18 years. This is the
/// application-layer half of that defense-in-depth pair — the DB constraint
/// is the backstop if this check is ever bypassed or has a bug.
export function isAtLeast18(dateOfBirth: Date, asOf: Date = new Date()): boolean {
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - MINIMUM_AGE_YEARS);
  return dateOfBirth.getTime() <= cutoff.getTime();
}

export function calculateAge(dateOfBirth: Date, asOf: Date = new Date()): number {
  let age = asOf.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = asOf.getMonth() - dateOfBirth.getMonth();
  const dayDiff = asOf.getDate() - dateOfBirth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age--;
  }
  return age;
}

export type Gender = "MALE" | "FEMALE";
export type Directory = "MEN" | "WOMEN";

/// The whole of "MEN directory classification / WOMEN directory
/// classification" per the Phase 2 instruction: gender determines directory
/// 1:1, so this is a pure derivation rather than a separate stored column
/// (storing it redundantly would just be another place the two facts could
/// drift out of sync). Partner discovery itself is explicitly out of scope
/// for this phase — this function exists so that scope, when built, has a
/// single canonical place to get this classification from.
export function classifyDirectory(gender: Gender): Directory {
  return gender === "MALE" ? "MEN" : "WOMEN";
}
