import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { encryptMessage, decryptMessage } from "@/lib/messageEncryption";
import { scanText } from "@/lib/contentDetection";

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

async function getOrCreateConversation(connectionId: string) {
  const admin = getAdminClient();
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("connectionId", connectionId)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created, error } = await admin
    .from("conversations")
    .insert({ connectionId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: connection, error: connError } = await supabase
    .from("connections")
    .select("id, userAId, userBId, status")
    .eq("id", connectionId)
    .single();
  if (connError || !connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.userAId !== user.id && connection.userBId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let conversationId: string;
  try {
    conversationId = await getOrCreateConversation(connectionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load conversation" }, { status: 500 });
  }

  const { data: rows, error: msgError } = await supabase
    .from("messages")
    .select("id, senderId, type, ciphertext, nonce, readAt, deletedAt, createdAt")
    .eq("conversationId", conversationId)
    .order("createdAt", { ascending: true })
    .limit(200);

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  const admin = getAdminClient();
  const voiceMessageIds = (rows ?? []).filter((m: any) => m.type === "VOICE" && !m.deletedAt).map((m: any) => m.id);
  const voiceByMessage = new Map<string, { audioStorageKey: string; durationSeconds: number }>();
  if (voiceMessageIds.length) {
    const { data: voiceRows } = await admin
      .from("voice_messages")
      .select("messageId, audioStorageKey, durationSeconds")
      .in("messageId", voiceMessageIds);
    (voiceRows ?? []).forEach((v: any) => voiceByMessage.set(v.messageId, v));
  }

  const messages = await Promise.all(
    (rows ?? []).map(async (m: any) => {
      if (m.deletedAt) {
        return {
          id: m.id,
          senderId: m.senderId,
          isMine: m.senderId === user.id,
          type: m.type,
          content: "[deleted]",
          deleted: true,
          readAt: m.readAt,
          createdAt: m.createdAt,
        };
      }
      if (m.type === "VOICE") {
        const voice = voiceByMessage.get(m.id);
        let audioUrl: string | null = null;
        if (voice) {
          const { data: signed } = await admin.storage
            .from("voice-messages")
            .createSignedUrl(voice.audioStorageKey, 3600);
          audioUrl = signed?.signedUrl ?? null;
        }
        return {
          id: m.id,
          senderId: m.senderId,
          isMine: m.senderId === user.id,
          type: "VOICE",
          audioUrl,
          durationSeconds: voice?.durationSeconds ?? null,
          readAt: m.readAt,
          createdAt: m.createdAt,
        };
      }
      let content = "";
      try {
        const ciphertext = Buffer.from(m.ciphertext.replace(/^\\x/, ""), "hex");
        const nonce = Buffer.from(m.nonce.replace(/^\\x/, ""), "hex");
        content = decryptMessage(ciphertext, nonce);
      } catch {
        content = "[Unable to decrypt this message]";
      }
      return {
        id: m.id,
        senderId: m.senderId,
        isMine: m.senderId === user.id,
        type: m.type,
        content,
        readAt: m.readAt,
        createdAt: m.createdAt,
      };
    })
  );

  const unreadIds = (rows ?? [])
    .filter((m: any) => m.senderId !== user.id && !m.readAt)
    .map((m: any) => m.id);
  if (unreadIds.length) {
    await supabase.from("messages").update({ readAt: new Date().toISOString() }).in("id", unreadIds);
  }

  return NextResponse.json({ conversationId, messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "Message content is required" }, { status: 400 });
  }
  if (content.length > 4000) {
    return NextResponse.json({ error: "Message is too long (4000 character limit)" }, { status: 400 });
  }

  const { data: connection, error: connError } = await supabase
    .from("connections")
    .select("id, userAId, userBId, status")
    .eq("id", connectionId)
    .single();
  if (connError || !connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.userAId !== user.id && connection.userBId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (connection.status !== "ACTIVE") {
    return NextResponse.json({ error: "This connection is no longer active" }, { status: 409 });
  }

  let conversationId: string;
  try {
    conversationId = await getOrCreateConversation(connectionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load conversation" }, { status: 500 });
  }

  const { ciphertext, nonce } = encryptMessage(content);

  const { data: created, error } = await supabase
    .from("messages")
    .insert({
      conversationId,
      senderId: user.id,
      type: "TEXT",
      ciphertext: "\\x" + ciphertext.toString("hex"),
      nonce: "\\x" + nonce.toString("hex"),
    })
    .select("id, createdAt")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Automated flagging — a pre-screening heuristic only, never an
  // automatic judgment. Matches are recorded for human review and
  // never block sending or notify anyone automatically. See
  // src/lib/contentDetection.ts for exactly what this does and doesn't do.
  try {
    const matches = scanText(content);
    if (matches.length > 0) {
      const admin = getAdminClient();
      await admin.from("content_flags").insert(
        matches.map((m) => ({
          contentType: "message",
          contentId: created.id,
          flaggedUserId: user.id,
          category: m.category,
          confidenceScore: m.confidence,
          detectionSource: "KEYWORD_HEURISTIC_V1",
          matchedTerms: m.matchedTerms,
          status: "PENDING_REVIEW",
        }))
      );
    }
  } catch {
    // Flagging is best-effort and must never block message delivery.
  }

  return NextResponse.json({
    id: created.id,
    senderId: user.id,
    isMine: true,
    type: "TEXT",
    content,
    readAt: null,
    createdAt: created.createdAt,
  });
}
