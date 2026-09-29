import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getVideoProvider } from "@/lib/ai/registry";
import { redactSecrets } from "@/lib/ai/types";
import { AI_MEDIA_LABEL } from "@/lib/aiPastor/mediaPolicy";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// GET a media job's status. RLS (ai_media_jobs_select_own) already restricts
// this to the job's own owner — this route does not re-derive that, it
// relies on the policy, same pattern as every other member-owned resource
// on this platform.
//
// For a still-PROCESSING video job, this also polls the provider once and
// persists any change — so status updates happen on the member's own
// refresh cadence rather than a separate background worker (Phase 16
// amendment §22: no overbuilding beyond what's required this phase).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: job, error } = await supabase.from("ai_media_generation_jobs").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = getAdminClient();

  if (job.mediaType === "VIDEO" && job.status === "PROCESSING" && job.providerOperationRef) {
    const { data: settings } = await supabase.from("ai_pastor_settings").select("*").eq("id", true).single();
    const provider = getVideoProvider(settings);
    if (provider) {
      try {
        const poll = await provider.pollVideo(job.providerOperationRef);
        if (poll.done) {
          if (poll.ok) {
            const path = `${user.id}/${job.id}.mp4`;
            const { error: uploadError } = await admin.storage.from("ai-media").upload(path, poll.data, { contentType: poll.mimeType, upsert: true });
            if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);
            await admin
              .from("ai_media_generation_jobs")
              .update({ status: "COMPLETED", storagePath: path, mimeType: poll.mimeType, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
              .eq("id", id);
            job.status = "COMPLETED";
            job.storagePath = path;
          } else {
            await admin
              .from("ai_media_generation_jobs")
              .update({ status: "FAILED", failureReason: redactSecrets(poll.error).slice(0, 200), updatedAt: new Date().toISOString() })
              .eq("id", id);
            job.status = "FAILED";
            job.failureReason = poll.error;
          }
        }
      } catch (err) {
        // Do not fail the request over a poll hiccup — report current (still PROCESSING) state and try again next poll.
        job.pollError = redactSecrets(err instanceof Error ? err.message : "poll failed");
      }
    }
  }

  let url: string | null = null;
  if (job.status === "COMPLETED" && job.storagePath) {
    const { data: signed } = await admin.storage.from("ai-media").createSignedUrl(job.storagePath, 300);
    url = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    job: {
      id: job.id,
      mediaType: job.mediaType,
      status: job.status,
      failureReason: job.failureReason ?? null,
      label: job.mediaType === "IMAGE" ? AI_MEDIA_LABEL.IMAGE : AI_MEDIA_LABEL.VIDEO,
    },
    url,
  });
}
