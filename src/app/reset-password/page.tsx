"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

type PasswordInputProps = {
  confirm?: boolean;
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onToggle: () => void;
};

function PasswordInput({ confirm = false, visible, value, onChange, onToggle }: PasswordInputProps) {
  return (
    <label className="block text-sm font-medium text-[#0D1B3E]">
      {confirm ? "Confirm new password" : "New password"}
      <span className="relative mt-1.5 block">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          minLength={8}
          required
          className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 pr-14 outline-none focus:border-[#C9A84C]"
        />
        <button type="button" onClick={onToggle} className="absolute inset-y-0 right-0 flex w-14 items-center justify-center text-xs text-gray-400 hover:text-[#C9A84C]" aria-label={visible ? "Hide password" : "Show password"}>
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!token) return setError("This reset link is invalid. Request a new link from your administrator.");
    if (password.length < 8) return setError("Your new password must be at least 8 characters.");
    if (password !== confirmPassword) return setError("The passwords do not match.");
    setLoading(true);
    const response = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error || "Unable to reset your password.");
    setSuccess(data.message);
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F0F2F8] p-4">
      <section className="w-full max-w-md rounded-2xl border border-[#0D1B3E]/10 bg-white p-6 shadow-xl">
        <p className="text-xs font-semibold tracking-[0.2em] text-[#C9A84C]">HIROMA</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#0D1B3E]">Set a new password</h1>
        <p className="mt-2 text-sm text-gray-500">Choose a secure new password for your account.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <PasswordInput visible={showPassword} value={password} onChange={setPassword} onToggle={() => setShowPassword((current) => !current)} />
          <PasswordInput confirm visible={showConfirmPassword} value={confirmPassword} onChange={setConfirmPassword} onToggle={() => setShowConfirmPassword((current) => !current)} />
          {error && <p className="rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#a03030]">{error}</p>}
          {success && <p className="rounded-lg bg-[#e8f7ef] px-3 py-2 text-sm text-[#1a7a4a]">{success}</p>}
          <button disabled={loading || Boolean(success)} className="w-full rounded-lg bg-[#C9A84C] py-2.5 font-medium text-white hover:bg-[#b8963e] disabled:opacity-50">
            {loading ? "Saving..." : "Reset password"}
          </button>
        </form>
        <Link href="/login" className="mt-5 block text-center text-sm text-[#9a6f1e] hover:underline">Back to sign in</Link>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#F0F2F8] p-4"><p className="text-sm text-gray-500">Loading password reset…</p></main>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
