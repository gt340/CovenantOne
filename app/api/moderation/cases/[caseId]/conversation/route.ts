import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { decryptMessage } from "@/lib/messageEncryption";

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
 * SECURITY NOTE: this route does not itself decide whether the caller is
 * allowed to see the conversation — the database does, via the
 * `messages_select_moderation_case` / `conversations_select_moderation_case`
 * RLS policies (private.has_active_moderation_access), which require an
 * OPEN/INVESTIGATING/ESCALATED case assigned to this exact user, at
 * SAFETY_MODERATOR tier or above. If the caller doesn't qualify, the
 * queries below simply return zero rows — there is no separate bypass
 * path. Every access that returns data is logged to audit_logs below;
 * a query returning nothing (unauthorized, or genuinely empty) is not
 * logged, since nothing was actually accessed.
 *
 * Conversation resolution below tries every applicable strategy and
 * merges the results, rather than an either/or chain — a report's
 * relatedContentType may point at a conversation, a message, or (as the
 * general "report this person" flow does) a connection, and regardless
 * we also always check reportedUserId's own connections as a fallback.
 * This was tightened after finding the connection-based report path
 * had been silently mislabeled as relatedContentType "conversation"
 * with a connection id, which meant a real report+case resolved to
 * zero conversations. RLS itself was never at risk — this fixes the
 * app-level lookup, not the authorization boundary.
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

  const { data: modCase, error: caseError } = await supabase
    .from("moderation_cases")
    .select("id, reportId, assignedModeratorId, status")
    .eq("id", caseId)
    .single();
  if (caseError || !modCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const { data: report } = await supabase
    .from("reports")
    .select("relatedContentType, relatedContentId, reportedUserId")
    .eq("id", modCase.reportId)
    .single();

  const conversationIdSet = new Set<string>();

  if (report?.relatedContentType === "conversation" && report.relatedContentId) {
    conversationIdSet.add(report.relatedContentId);
  }
  if (report?.relatedContentType === "connection" && report.relatedContentId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("connectionId", report.relatedContentId)
      .maybeSingle();
    if (conv) conversationIdSet.add(conv.id);
  }
  if (report?.relatedContentType === "message" && report.relatedContentId) {
    const { data: msg } = await supabase
      .from("messages")
      .select("conversationId")
      .eq("id", report.relatedContentId)
      .maybeSingle();
    if (msg) conversationIdSet.add(msg.conversationId);
  }
  // Always also resolve via reportedUserId's own connections, regardless
  // of relatedContentType — covers the general "report this person" case
  // and any mislabeled/missing relatedContentType.
  if (report?.reportedUserId) {
    const { data: conns } = await supabase
      .from("connections")
      .select("id")
      .or(`userAId.eq.${report.reportedUserId},userBId.eq.${report.reportedUserId}`);
    if (conns?.length) {
      const { data: convs } = await supabase
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
    // This SELECT is the actual authorization check — RLS silently
    // returns zero rows if has_active_moderation_access() is false for
    // this caller and conversation, regardless of what was resolved above.
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
