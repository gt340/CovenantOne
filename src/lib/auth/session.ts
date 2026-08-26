import { createClient } from "../supabase/server";
import { canAccessApp, type UserStatus } from "../domain/account-status";

export interface SessionUser {
  id: string;
  email: string | undefined;
  role: string;
  status: UserStatus;
}

export interface SessionResult {
  user: SessionUser | null;
  error: string | null;
}

/// Reads the caller's Supabase session AND their public.users row (role +
/// status) in one place, so every route handler applies the same account
/// lifecycle rules instead of re-deciding them ad hoc. Returns null (not a
/// throw) when there's no session — callers decide what "no session" means
/// for their specific route.
export async function getSessionUser(): Promise<SessionResult> {
  const supabase = createClient();

  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return { user: null, error: authError?.message ?? "Not signed in." };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("users")
    .select("role, status")
    .eq("id", authUser.id)
    .single();

  if (profileError || !profileRow) {
    // This shouldn't happen if the handle_new_auth_user trigger fired
    // correctly, but fail closed rather than assuming a default role/status.
    return { user: null, error: "Account record not found." };
  }

  return {
    user: {
      id: authUser.id,
      email: authUser.email,
      role: profileRow.role,
      status: profileRow.status as UserStatus,
    },
    error: null,
  };
}

/// For routes that require a fully ACTIVE account (post-verification
/// onboarding steps, and everything beyond onboarding). Returns a
/// discriminated result so callers can respond with the right HTTP status
/// and message instead of a generic 401/403.
export async function requireActiveUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; status: number; message: string }
> {
  const { user, error } = await getSessionUser();
  if (!user) {
    return { ok: false, status: 401, message: error ?? "Not signed in." };
  }
  const decision = canAccessApp(user.status);
  if (!decision.allowed) {
    const status = decision.reason === "PENDING_VERIFICATION" ? 403 : 403;
    return { ok: false, status, message: decision.reason ?? "Account not active." };
  }
  return { ok: true, user };
}

/// For the verification step itself, which a PENDING_VERIFICATION account
/// must be able to reach (that's the whole point of the step) but a
/// SUSPENDED/BANNED/DELETED account must not.
export async function requireVerifiableUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; status: number; message: string }
> {
  const { user, error } = await getSessionUser();
  if (!user) {
    return { ok: false, status: 401, message: error ?? "Not signed in." };
  }
  if (user.status !== "PENDING_VERIFICATION" && user.status !== "ACTIVE") {
    return { ok: false, status: 403, message: user.status };
  }
  return { ok: true, user };
}
