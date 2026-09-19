"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

function safeNext(value: unknown): string {
  const next = String(value ?? "/");
  if (next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) return next;
  return "/";
}

export async function signIn(_prev: { error: string } | null, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(next);
}

export async function setPassword(_prev: { error: string } | null, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
