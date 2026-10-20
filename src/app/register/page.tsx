"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Registration failed");
        setLoading(false);
        return;
      }

      // Auto-login after successful registration.
      const signInRes = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });

      setLoading(false);

      if (!signInRes || signInRes.error) {
        // Account exists but auto-login failed; send them to the login page.
        router.push("/login");
        return;
      }

      router.push("/targets");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
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
        <h1 className="text-2xl font-semibold">Create an account</h1>
        <p className="mt-1 text-sm text-muted">
          Set up your account to start hunting.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Name
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-normal text-foreground placeholder:text-subtle focus:border-brand"
            />
          </label>

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
              minLength={10}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-normal text-foreground placeholder:text-subtle focus:border-brand"
            />
            <span className="text-xs font-normal text-subtle">
              At least 10 characters.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-brand">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
