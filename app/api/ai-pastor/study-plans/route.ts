import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getAuthedClientAndUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

const STUDY_TYPES = [
  "MARRIAGE", "WISDOM", "PROVERBS", "FAITH", "LEADERSHIP", "BUSINESS_ETHICS",
  "FAMILY", "CHARACTER", "FORGIVENESS", "DISCIPLINE", "STEWARDSHIP",
] as const;

// Foundational study-plan skeleton (Phase 16 §9). Steps hold a topic, a
// scripture *search term* (not scripture text — the text is fetched live
// from the Bible provider when the member opens a step) and reflection
// prompts. AI-generated, provider-grounded plans are a later enhancement;
// this ships the storage + progress-tracking architecture with template steps.
const STEP_TEMPLATES: Record<string, { title: string; searchTerm: string; reflection: string }[]> = {
  MARRIAGE: [
    { title: "Foundations of covenant", searchTerm: "marriage covenant", reflection: "What does commitment mean to you before feelings?" },
    { title: "Love in practice", searchTerm: "love patient kind", reflection: "Where do you find patience hardest?" },
    { title: "Communication", searchTerm: "gentle answer", reflection: "How do you respond when someone is upset with you?" },
  ],
  WISDOM: [
    { title: "Beginning of wisdom", searchTerm: "fear of the Lord wisdom", reflection: "Where are you seeking wisdom right now?" },
    { title: "Listening and counsel", searchTerm: "counsel advisers", reflection: "Who do you trust for counsel?" },
  ],
  FORGIVENESS: [
    { title: "Receiving forgiveness", searchTerm: "forgiven", reflection: "What is hard to accept forgiveness for?" },
    { title: "Extending forgiveness", searchTerm: "forgive one another", reflection: "Is there someone you are holding a grudge against?" },
  ],
};

const DEFAULT_STEPS = [
  { title: "Introduction", searchTerm: "", reflection: "What do you hope to learn from this study?" },
  { title: "Key passages", searchTerm: "", reflection: "Which passage stood out and why?" },
  { title: "Application", searchTerm: "", reflection: "What is one practical step you will take?" },
];

export async function GET() {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("bible_study_plans")
    .select("id, studyType, title, status, steps, createdAt, updatedAt")
    .order("updatedAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plans: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { studyType?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.studyType || !(STUDY_TYPES as readonly string[]).includes(body.studyType)) {
    return NextResponse.json({ error: `studyType must be one of ${STUDY_TYPES.join(", ")}` }, { status: 400 });
  }

  const templates = STEP_TEMPLATES[body.studyType] ?? DEFAULT_STEPS;
  const steps = templates.map((t) => ({ ...t, completedAt: null }));

  const { data, error } = await supabase
    .from("bible_study_plans")
    .insert({
      userId: user.id,
      studyType: body.studyType,
      title: body.title?.trim() || `${body.studyType.replace(/_/g, " ").toLowerCase()} study`,
      steps,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
