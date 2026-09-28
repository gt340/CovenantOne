// Server-side rate limiting for every AI cost surface (Phase 16 amendment
// §12). All enforcement goes through ONE function, enforceRateLimit(), which
// calls the atomic Postgres function public.check_ai_rate_limit (per-user +
// per-kind advisory lock, so a concurrent burst can't slip past the count).
// Every route that can spend money must call this — TEXT (chat), IMAGE and
// VIDEO (media endpoint) — so there is no alternate path around it.
//
// It FAILS CLOSED: if the limiter itself errors, the request is denied,
// because "limiter down" must never mean "unlimited spending".

export type LimitKind = "TEXT" | "IMAGE" | "VIDEO";
export type LimitConfig = { perMinute: number; perDay: number; maxConcurrent?: number };
export type Limits = Record<LimitKind, LimitConfig>;

export const DEFAULT_LIMITS: Limits = {
  TEXT: { perMinute: 6, perDay: 100 },
  IMAGE: { perMinute: 2, perDay: 10, maxConcurrent: 2 },
  VIDEO: { perMinute: 1, perDay: 2, maxConcurrent: 1 },
};

const CEILING = { perMinute: 60, perDay: 1000, maxConcurrent: 10 };

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? Math.floor(value) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** Merges admin-supplied limits over defaults; invalid or absurd values fall back / are clamped. */
export function parseLimits(raw: unknown): Limits {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const out = {} as Limits;
  for (const kind of ["TEXT", "IMAGE", "VIDEO"] as LimitKind[]) {
    const d = DEFAULT_LIMITS[kind];
    const r = src[kind] ?? {};
    out[kind] = {
      perMinute: clampInt(r.perMinute, d.perMinute, CEILING.perMinute),
      perDay: clampInt(r.perDay, d.perDay, CEILING.perDay),
      ...(kind !== "TEXT" ? { maxConcurrent: clampInt(r.maxConcurrent, d.maxConcurrent ?? 1, CEILING.maxConcurrent) } : {}),
    };
  }
  return out;
}

export type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "MINUTE_LIMIT" | "DAY_LIMIT" | "CONCURRENT_LIMIT" | "LIMITER_UNAVAILABLE"; retryAfterSeconds: number };

const RETRY_AFTER = { MINUTE_LIMIT: 60, DAY_LIMIT: 3600, CONCURRENT_LIMIT: 30, LIMITER_UNAVAILABLE: 30 } as const;

export async function enforceRateLimit(client: RpcClient, userId: string, kind: LimitKind, limits: Limits): Promise<RateLimitResult> {
  const cfg = limits[kind];
  try {
    const { data, error } = await client.rpc("check_ai_rate_limit", {
      p_user: userId,
      p_kind: kind,
      p_per_minute: cfg.perMinute,
      p_per_day: cfg.perDay,
      p_max_concurrent: cfg.maxConcurrent ?? null,
    });
    if (error) return { allowed: false, reason: "LIMITER_UNAVAILABLE", retryAfterSeconds: RETRY_AFTER.LIMITER_UNAVAILABLE };
    if (data === "OK") return { allowed: true };
    if (data === "MINUTE_LIMIT" || data === "DAY_LIMIT" || data === "CONCURRENT_LIMIT") {
      return { allowed: false, reason: data, retryAfterSeconds: RETRY_AFTER[data] };
    }
    return { allowed: false, reason: "LIMITER_UNAVAILABLE", retryAfterSeconds: RETRY_AFTER.LIMITER_UNAVAILABLE };
  } catch {
    return { allowed: false, reason: "LIMITER_UNAVAILABLE", retryAfterSeconds: RETRY_AFTER.LIMITER_UNAVAILABLE };
  }
}
