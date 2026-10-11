import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KnowledgeResult, KnowledgeSearchFn } from "./knowledgeRetrieval";

// Production knowledge search: calls the SECURITY DEFINER SQL function
// public.search_approved_knowledge (service_role only). Eligibility filters
// (APPROVED, current production, not archived, licence not unknown/restricted,
// MEMBER_FACING unless an admin test asks otherwise) live in the SQL itself,
// so no caller can widen them. Every result seen is pushed to `capture` so
// the caller can record traceability without a second query.
export type CapturedKnowledge = KnowledgeResult & { version?: number; licenseStatus?: string; approvalStatus?: string };

export function createKnowledgeSearch(
  admin: SupabaseClient,
  opts: { includeAdminOnly?: boolean; capture?: CapturedKnowledge[] } = {}
): KnowledgeSearchFn {
  return async (query, limit = 4) => {
    const { data, error } = await admin.rpc("search_approved_knowledge", {
      p_query: query,
      p_limit: limit,
      p_include_admin_only: opts.includeAdminOnly === true,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CapturedKnowledge[];
    if (opts.capture) opts.capture.push(...rows);
    return rows;
  };
}

export function hashQuestion(question: string): string {
  return createHash("sha256").update(question.trim().toLowerCase()).digest("hex");
}

export function summarizeSelected(rows: CapturedKnowledge[]) {
  return rows.map((r) => ({
    chunkId: r.chunkId, sourceId: r.sourceId, version: r.version ?? null, title: r.title, sourceType: r.sourceType,
    trustLevel: r.trustLevel, licenseStatus: r.licenseStatus ?? null, approvalStatus: r.approvalStatus ?? null, rank: r.rank,
  }));
}
