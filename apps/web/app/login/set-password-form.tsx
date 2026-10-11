"use client";

import { useActionState } from "react";
import { Logo } from "@/components/Logo";
import { setPassword, signOut } from "./actions";

const fieldClass =
  "mt-2 w-full border border-[#3a342e] bg-[#161412] px-3 py-2 text-sm outline-none focus:border-[#d4783b]";

export function SetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(setPassword, null);

  return (
    <div className="w-full max-w-sm border border-[#3a342e] bg-[#211e1b] p-8">
      <Logo className="block h-20 w-auto" />
      <h1 className="mt-3 text-3xl">Set a password</h1>
      <p className="mt-2 text-sm text-[#b7aaa0]">
        Signed in as {email}. Save a password now so the next visit does not need a magic link.
      </p>
      <form action={action}>
        <label className="mt-6 block text-xs uppercase tracking-wider text-[#b7aaa0]">
          New password
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={fieldClass}
          />
        </label>
        <label className="mt-4 block text-xs uppercase tracking-wider text-[#b7aaa0]">
          Confirm password
          <input
            type="password"
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="mt-5 w-full bg-[#d4783b] px-3 py-2 text-sm font-medium text-[#161412] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save password"}
        </button>
        {state?.error ? <p className="mt-4 text-sm text-[#d4783b]">{state.error}</p> : null}
      </form>
      <form action={signOut} className="mt-4">
        <button type="submit" className="w-full border border-[#3a342e] px-3 py-2 text-xs uppercase tracking-wider">
          Sign out
        </button>
      </form>
    </div>
  );
}
