"use client";

import { useActionState } from "react";
import { Logo } from "@/components/Logo";
import { signIn } from "./actions";

const fieldClass =
  "mt-2 w-full border border-[#3a342e] bg-[#161412] px-3 py-2 text-sm outline-none focus:border-[#d4783b]";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="w-full max-w-sm border border-[#3a342e] bg-[#211e1b] p-8">
      <Logo className="block h-20 w-auto" />
      <h1 className="mt-4 text-3xl">Sign in</h1>
      <p className="mt-2 text-sm text-[#b7aaa0]">Company email and password.</p>
      <input type="hidden" name="next" value={next} />
      <label className="mt-6 block text-xs uppercase tracking-wider text-[#b7aaa0]">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          className={fieldClass}
        />
      </label>
      <label className="mt-4 block text-xs uppercase tracking-wider text-[#b7aaa0]">
        Password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={fieldClass}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-5 w-full bg-[#d4783b] px-3 py-2 text-sm font-medium text-[#161412] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state?.error ? <p className="mt-4 text-sm text-[#d4783b]">{state.error}</p> : null}
    </form>
  );
}
