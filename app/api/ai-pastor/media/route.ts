import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { describeAll, getImageProvider, getVideoProvider } from "@/lib/ai/registry";
import { redactSecrets } from "@/lib/ai/types";
import { classifyQuestion } from "@/lib/aiPastor/classification";
import { scanForSafetyBoundary } from "@/lib/aiPastor/safetyBoundaries";
import { AI_MEDIA_LABEL, buildImagePrompt, buildVideoPrompt, decideMedia, type MediaMode } from "@/lib/aiPastor/mediaPolicy";
import { enforceRateLimit, parseLimits } from "@/lib/aiPastor/rateLimit";

export const maxDuration = 60; // image generation runs inline; video is started here and finished via polling

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };
const STALE_MINUTES = { IMAGE: 5, VIDEO: 30 } as const;

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// POST { kind: "IMAGE" | "VIDEO", subject, conversationId? }
//
// The ONLY path that can start image/video generation. Every request passes,
// in order: authentication -> input validation -> conversation ownership ->
// safety scan -> media policy (mode / provider ready / account active) ->
// SERVER-SIDE rate limit (per-kind, atomic) -> job record -> provider call.
// Clicking a button counts as the explicit request; the policy gates still apply.
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { kind?: string; subject?: string; conversationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const kind = body.kind === "IMAGE" || body.kind === "VIDEO" ? body.kind : null;
  const subject = body.subject?.trim();
  if (!kind) return NextResponse.json({ error: "kind must be IMAGE or VIDEO" }, { status: 400 });
  if (!subject || subject.length < 3 || subject.length > 500) {
    return NextResponse.json({ error: "subject must be between 3 and 500 characters" }, { status: 400 });
  }

  if (body.conversationId) {
    const { data: owned } = await supabase.from("ai_pastor_conversations").select("id").eq("id", body.conversationId).maybeSingle();
    if (!owned) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const admin = getAdminClient();
  const { data: settings } = await supabase.from("ai_pastor_settings").select("*").eq("id", true).single();
  const { data: account } = await supabase.from("users").select("status").eq("id", user.id).maybeSingle();
  const providers = describeAll(settings);

  const decision = decideMedia({
    message: subject,
    topic: classifyQuestion(subject),
    mode: (settings?.mediaMode ?? "OFF") as MediaMode,
    imageReady: providers.image.state === "READY",
    videoReady: providers.video.state === "READY",
    safetyTriggered: scanForSafetyBoundary(subject).triggered,
    accountActive: account?.status === "ACTIVE",
    explicit: kind === "IMAGE" ? "image" : "video",
  });
  const allowed = kind === "IMAGE" ? decision.shouldGenerateImage : decision.shouldGenerateVideo;
  if (!allowed) {
    if (decision.reason === "IMAGE_PROVIDER_NOT_READY") return NextResponse.json({ error: "IMAGE PROVIDER NOT CONFIGURED", reason: decision.reason }, { status: 503 });
    if (decision.reason === "VIDEO_PROVIDER_NOT_READY") return NextResponse.json({ error: "VIDEO PROVIDER NOT CONFIGURED", reason: decision.reason }, { status: 503 });
    return NextResponse.json({ error: "Media generation is not available for this request.", reason: decision.reason }, { status: 403 });
  }

  // Free slots held by jobs that died mid-flight (e.g. a function timeout), so
  // a crash can't lock a member out of the concurrency limit.
  const cutoff = new Date(Date.now() - STALE_MINUTES[kind] * 60_000).toISOString();
  await admin
    .from("ai_media_generation_jobs")
    .update({ status: "FAILED", failureReason: "TIMEOUT", updatedAt: new Date().toISOString() })
    .eq("userId", user.id)
    .eq("mediaType", kind)
    .in("status", ["REQUESTED", "QUEUED", "PROCESSING"])
    .lt("createdAt", cutoff);

  const limit = await enforceRateLimit(admin, user.id, kind, parseLimits(settings?.rateLimits));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Media generation limit reached. Please try again later.", reason: limit.reason, retryAfterSeconds: limit.retryAfterSeconds },
      { status: limit.reason === "LIMITER_UNAVAILABLE" ? 503 : 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const resolved = kind === "IMAGE" ? providers.image : providers.video;
  const { data: job, error: jobError } = await admin
    .from("ai_media_generation_jobs")
    .insert({
      userId: user.id,
      conversationId: body.conversationId ?? null,
      mediaType: kind,
      provider: resolved.provider,
      model: resolved.model,
      status: "REQUESTED",
      promptReference: classifyQuestion(subject), // topic label only — never the prompt text
    })
    .select("id")
    .single();
  if (jobError || !job) return NextResponse.json({ error: "Could not create media job" }, { status: 500 });

  const fail = async (reason: string) => {
    await admin
      .from("ai_media_generation_jobs")
      .update({ status: "FAILED", failureReason: redactSecrets(reason).slice(0, 200), updatedAt: new Date().toISOString() })
      .eq("id", job.id);
  };

  try {
    await admin.from("ai_media_generation_jobs").update({ status: "PROCESSING", updatedAt: new Date().toISOString() }).eq("id", job.id);

    if (kind === "VIDEO") {
      const started = await getVideoProvider(settings)!.startVideo({ prompt: buildVideoPrompt(subject) });
      await admin
        .from("ai_media_generation_jobs")
        .update({ providerOperationRef: started.operationRef, updatedAt: new Date().toISOString() })
        .eq("id", job.id);
      return NextResponse.json({ job: { id: job.id, mediaType: kind, status: "PROCESSING", label: AI_MEDIA_LABEL.VIDEO } }, { status: 202 });
    }

    const image = await getImageProvider(settings)!.generateImage({ prompt: buildImagePrompt(subject) });
    const path = `${user.id}/${job.id}.${EXT[image.mimeType] ?? "png"}`;
    const { error: uploadError } = await admin.storage.from("ai-media").upload(path, image.data, { contentType: image.mimeType, upsert: true });
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

    await admin
      .from("ai_media_generation_jobs")
      .update({ status: "COMPLETED", storagePath: path, mimeType: image.mimeType, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .eq("id", job.id);
    const { data: signed } = await admin.storage.from("ai-media").createSignedUrl(path, 300);
    return NextResponse.json(
      { job: { id: job.id, mediaType: kind, status: "COMPLETED", label: AI_MEDIA_LABEL.IMAGE }, url: signed?.signedUrl ?? null },
      { status: 201 }
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "generation failed";
    await fail(reason);
    return NextResponse.json({ job: { id: job.id, mediaType: kind, status: "FAILED" }, error: `${kind === "IMAGE" ? "Image" : "Video"} generation failed.` }, { status: 502 });
  }
}
