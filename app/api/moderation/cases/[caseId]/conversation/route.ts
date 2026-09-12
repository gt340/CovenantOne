import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { decryptMessage } from "@/lib/messageEncryption";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthedClientAndUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * SECURITY NOTE: the REAL authorization boundary in this route is the
 * final messages SELECT, run on the caller's own RLS-scoped session —
 * RLS (private.has_active_moderation_access) silently returns zero rows
 * if this caller isn't a properly-assigned SAFETY_MODERATOR-tier user on
 * an open case for that conversation. There is no other path to the
 * message content.
 *
 * The steps BEFORE that (figuring out which conversation a report is
 * even talking about) are not a security boundary — they're just
 * bookkeeping to resolve an id — but they were incorrectly run on the
 * caller's own session in an earlier version of this file, which
 * silently broke: `connections` has no RLS policy granting a
 * SAFETY_MODERATOR read access to a connection they're not part of, so
 * the lookup itself returned nothing before authorization was ever
 * checked. Fixed by using a privileged client only for this resolution
 * step. This does not weaken security: it only helps find the right id
 * to look up, and the actual read of message content below still goes
 * through the caller's own session and real RLS enforcement.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const reason = searchParams.get("reason")?.trim();
  if (!reason) {
    return NextResponse.json({ error: "A reason query parameter is required for every access" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: modCase, error: caseError } = await admin
    .from("moderation_cases")
    .select("id, reportId, assignedModeratorId, status")
    .eq("id", caseId)
    .single();
  if (caseError || !modCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  // The case must actually be assigned to this exact caller — checked
  // here explicitly since we're about to use a privileged client for
  // resolution and want to fail fast rather than rely solely on the
  // final RLS check for this cheap, obvious mismatch.
  if (modCase.assignedModeratorId !== user.id) {
    return NextResponse.json({ conversations: [] });
  }

  const { data: report } = await admin
    .from("reports")
    .select("relatedContentType, relatedContentId, reportedUserId")
    .eq("id", modCase.reportId)
    .single();

  const conversationIdSet = new Set<string>();

  if (report?.relatedContentType === "conversation" && report.relatedContentId) {
    conversationIdSet.add(report.relatedContentId);
  }
  if (report?.relatedContentType === "connection" && report.relatedContentId) {
    const { data: conv } = await admin
      .from("conversations")
      .select("id")
      .eq("connectionId", report.relatedContentId)
      .maybeSingle();
    if (conv) conversationIdSet.add(conv.id);
  }
  if (report?.relatedContentType === "message" && report.relatedContentId) {
    const { data: msg } = await admin
      .from("messages")
      .select("conversationId")
      .eq("id", report.relatedContentId)
      .maybeSingle();
    if (msg) conversationIdSet.add(msg.conversationId);
  }
  if (report?.reportedUserId) {
    const { data: conns } = await admin
      .from("connections")
      .select("id")
      .or(`userAId.eq.${report.reportedUserId},userBId.eq.${report.reportedUserId}`);
    if (conns?.length) {
      const { data: convs } = await admin
        .from("conversations")
        .select("id")
        .in("connectionId", conns.map((c: any) => c.id));
      (convs ?? []).forEach((c: any) => conversationIdSet.add(c.id));
    }
  }

  const conversationIds = Array.from(conversationIdSet);
  if (conversationIds.length === 0) {
    return NextResponse.json({ conversations: [] });
  }

  const results = [];
  for (const conversationId of conversationIds) {
    // THE authorization check: run on the caller's own session, gated
    // by private.has_active_moderation_access() via RLS. Returns zero
    // rows unless this caller is genuinely the assigned SAFETY_MODERATOR
    // (or above) on an open case referencing this exact conversation.
    const { data: rows } = await supabase
      .from("messages")
      .select("id, senderId, type, ciphertext, nonce, deletedAt, createdAt")
      .eq("conversationId", conversationId)
      .order("createdAt", { ascending: true });

    if (!rows || rows.length === 0) continue;

    const messages = rows.map((m: any) => {
      let content = "";
      if (m.deletedAt) {
        content = "[deleted]";
      } else {
        try {
          content =
            m.type === "TEXT"
              ? decryptMessage(
                  Buffer.from(m.ciphertext.replace(/^\\x/, ""), "hex"),
                  Buffer.from(m.nonce.replace(/^\\x/, ""), "hex")
                )
              : "";
        } catch {
          content = "[Unable to decrypt this message]";
        }
      }
      return { id: m.id, senderId: m.senderId, type: m.type, content, deleted: !!m.deletedAt, createdAt: m.createdAt };
    });

    results.push({ conversationId, messages });

    // Mandatory audit record — uses the caller's own session too, so
    // this insert is itself subject to the audit_logs RLS insert policy
    // (actorUserId must equal auth.uid()), not just app-level trust.
    await supabase.from("audit_logs").insert({
      actorUserId: user.id,
      action: "MODERATION_CONVERSATION_ACCESSED",
      targetType: "conversation",
      targetId: conversationId,
      metadata: { reason, caseId, reportId: modCase.reportId, messageCount: messages.length },
    });
  }

  return NextResponse.json({ conversations: results });
}
