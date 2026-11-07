import { connection } from "next/server";
import Link from "next/link";
import RegisterForm from "@/components/RegisterForm";
import { publicRegistrationEnabled } from "@/lib/abusePolicy";

export default async function RegisterPage() {
  await connection();
  if (publicRegistrationEnabled()) return <RegisterForm />;
  return <div className="auth-ui mx-auto flex w-full min-h-screen max-w-md flex-col justify-center gap-4 px-4">
    <h1 className="text-2xl font-semibold">Public registration is disabled</h1>
    <p className="text-sm text-muted">Contact your administrator for an account.</p>
    <Link href="/login" className="text-brand hover:underline">Sign in</Link>
  </div>;
}
