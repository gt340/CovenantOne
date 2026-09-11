import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { REPORT_CATEGORY_VALUES } from "@/lib/reportCategories";

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

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    reportedUserId?: string;
    category?: string;
    description?: string;
    conversationId?: string;
    messageId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.reportedUserId) {
    return NextResponse.json({ error: "reportedUserId is required" }, { status: 400 });
  }
  if (body.reportedUserId === user.id) {
    return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 });
  }
  if (!body.category || !REPORT_CATEGORY_VALUES.includes(body.category as any)) {
    return NextResponse.json(
      { error: `category must be one of: ${REPORT_CATEGORY_VALUES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!body.description?.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  let relatedContentType: string | null = null;
  let relatedContentId: string | null = null;
  if (body.messageId) {
    relatedContentType = "message";
    relatedContentId = body.messageId;
  } else if (body.conversationId) {
    relatedContentType = "conversation";
    relatedContentId = body.conversationId;
  }

  const { data, error } = await supabase
    .from("reports")
    .insert({
      reporterId: user.id,
      reportedUserId: body.reportedUserId,
      category: body.category,
      description: body.description.trim(),
      relatedContentType,
      relatedContentId,
      status: "OPEN",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { ...data, note: "Thank you — our safety team will review this report." },
    { status: 201 }
  );
}
