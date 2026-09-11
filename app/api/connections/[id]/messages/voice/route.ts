import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

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

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB, generous for a voice-note-length clip
const MAX_DURATION_SECONDS = 300; // 5 minutes

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { audioBase64?: string; durationSeconds?: number; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.audioBase64) {
    return NextResponse.json({ error: "audioBase64 is required" }, { status: 400 });
  }
  const durationSeconds = Math.round(body.durationSeconds ?? 0);
  if (!durationSeconds || durationSeconds <= 0) {
    return NextResponse.json({ error: "durationSeconds is required and must be positive" }, { status: 400 });
  }
  if (durationSeconds > MAX_DURATION_SECONDS) {
    return NextResponse.json({ error: `Voice messages are limited to ${MAX_DURATION_SECONDS} seconds` }, { status: 400 });
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

  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(body.audioBase64, "base64");
  } catch {
    return NextResponse.json({ error: "audioBase64 could not be decoded" }, { status: 400 });
  }
  if (audioBuffer.length === 0) {
    return NextResponse.json({ error: "Audio data is empty" }, { status: 400 });
  }
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Voice message file is too large (10MB limit)" }, { status: 400 });
  }

  let conversationId: string;
  try {
    conversationId = await getOrCreateConversation(connectionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load conversation" }, { status: 500 });
  }

  const admin = getAdminClient();
  const extension = body.mimeType?.includes("mp4") ? "m4a" : "webm";
  const storageKey = `${conversationId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from("voice-messages")
    .upload(storageKey, audioBuffer, { contentType: body.mimeType ?? "audio/webm" });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed: " + uploadError.message }, { status: 500 });
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({ conversationId, senderId: user.id, type: "VOICE", ciphertext: "\\x", nonce: "\\x" })
    .select("id, createdAt")
    .single();
  if (messageError) {
    await admin.storage.from("voice-messages").remove([storageKey]);
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }

  const { error: voiceError } = await admin.from("voice_messages").insert({
    messageId: message.id,
    audioStorageKey: storageKey,
    durationSeconds,
  });
  if (voiceError) {
    return NextResponse.json({ error: voiceError.message }, { status: 500 });
  }

  const { data: signed } = await admin.storage.from("voice-messages").createSignedUrl(storageKey, 3600);

  return NextResponse.json({
    id: message.id,
    senderId: user.id,
    isMine: true,
    type: "VOICE",
    audioUrl: signed?.signedUrl ?? null,
    durationSeconds,
    readAt: null,
    createdAt: message.createdAt,
  });
}
