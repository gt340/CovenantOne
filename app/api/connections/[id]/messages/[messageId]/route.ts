import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const { messageId } = await params;
  const { supabase, user } = await getAuthedClientAndUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // RLS technically allows either conversation participant to update a
  // message row, so "sender-only" is enforced here at the app layer —
  // deleting is scoped to messages you sent, not messages sent to you.
  const { data: message, error: fetchError } = await supabase
    .from("messages")
    .select("id, senderId, deletedAt")
    .eq("id", messageId)
    .single();

  if (fetchError || !message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (message.senderId !== user.id) {
    return NextResponse.json({ error: "You can only delete your own messages" }, { status: 403 });
  }
  if (message.deletedAt) {
    return NextResponse.json({ error: "Message already deleted" }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("messages")
    .update({ deletedAt: new Date().toISOString() })
    .eq("id", messageId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
