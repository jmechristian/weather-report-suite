import { createSupabaseServer } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { SetPasswordForm } from "./set-password-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: nextParam } = await searchParams;
  const next =
    nextParam?.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\")
      ? nextParam
      : "/";

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {user?.email ? <SetPasswordForm email={user.email} /> : <LoginForm next={next} />}
    </main>
  );
}
