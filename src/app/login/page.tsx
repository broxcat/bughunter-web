import { Suspense } from "react";
import { connection } from "next/server";
import LoginForm from "@/components/LoginForm";
import { publicRegistrationEnabled } from "@/lib/abusePolicy";

export default async function LoginPage() {
  await connection(); // Runtime operator policy; never freeze it into a build.
  return <Suspense fallback={null}><LoginForm registrationEnabled={publicRegistrationEnabled()} /></Suspense>;
}
