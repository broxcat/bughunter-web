"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeLoginRedirect } from "@/lib/loginRedirect";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function LoginForm({ registrationEnabled }: { registrationEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeLoginRedirect(searchParams.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await signIn("credentials", { redirect: false, email, password });
      if (!res || res.error) {
        setError(res?.status === 503 || res?.code === "temporarily_unavailable"
          ? "Authentication temporarily unavailable. Please try again shortly."
          : res?.status === 429 || res?.code === "rate_limited"
            ? "Too many sign-in attempts. Please try again later."
            : "Invalid email or password");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" />
        <span className="font-semibold tracking-tight">bughunter</span>
      </div>

      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">
          Welcome back. Sign in to continue hunting.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-normal text-foreground placeholder:text-subtle focus:border-brand"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-normal text-foreground placeholder:text-subtle focus:border-brand"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-brand">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

      {registrationEnabled && <p className="mt-4 text-center text-sm text-muted">
        No account?{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          Create one
        </Link>
      </p>}
    </div>
  );
}
