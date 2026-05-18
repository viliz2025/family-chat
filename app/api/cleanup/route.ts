import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/session";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.rpc("cleanup_family_chat_messages");
  if (error) {
    return NextResponse.json({ error: "Не удалось очистить историю" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
