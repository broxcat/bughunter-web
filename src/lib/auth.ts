import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardCredentials } from "@/lib/credentialsGuard";
import { normalizeLogin, publicRegistrationEnabled } from "@/lib/abusePolicy";

/** M3: a session is valid only while its user exists with the same version. */
export async function sessionStillValid(token: { id?: unknown; sub?: unknown; sv?: unknown }) {
  const id = typeof token.id === "string" ? token.id : typeof token.sub === "string" ? token.sub : null;
  if (!id) return false;
  const user = await prisma.user.findUnique({ where: { id }, select: { sessionVersion: true } });
  return Boolean(user) && user!.sessionVersion === (typeof token.sv === "number" ? token.sv : 0);
}
/** Returning null makes Auth.js treat the session as signed out. */
export async function jwtCallback<T extends { id?: unknown; sub?: unknown; sv?: unknown }>({ token, user }: { token: T; user?: { id?: string; sessionVersion?: number } | null }): Promise<T | null> {
  if (user) {
    token.id = user.id;
    token.sv = user.sessionVersion ?? 0;
    return token;
  }
  return (await sessionStillValid(token)) ? token : null;
}
export function sessionMaxAgeSeconds(env: Record<string, string | undefined> = process.env) {
  const hours = Number(env.SESSION_MAX_AGE_HOURS ?? 12);
  return Number.isInteger(hours) && hours >= 1 && hours <= 24 * 7 ? hours * 3600 : 12 * 3600;
}

// Same bcrypt work for missing accounts and OAuth-only users. This is a public
// dummy hash, not an account credential.
const DUMMY_PASSWORD_HASH = "$2b$12$ExphlMmvboiLb3SyPjF.oeFQvHlMMz.DHBKQ29IvrbzMPtC1z7p96";

// Only enable an OAuth provider when its credentials are present, so the app
// boots in dev/CI without GitHub/Google secrets configured.
const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw, request) {
      const emailInput = z.string().trim().max(254).email().safeParse(raw.email);
      // Both quotas run before DB lookup/bcrypt, regardless of account existence.
      await guardCredentials(request, emailInput.success ? normalizeLogin(emailInput.data) : undefined);
      const parsed = z
        .object({ email: z.string().trim().max(254).email(), password: z.string().min(1).max(1024) })
        .safeParse(raw);
      if (!parsed.success) return null;

      const { email, password } = parsed.data;
      const user = await prisma.user.findUnique({
        where: { email: normalizeLogin(email) },
      });
      // OAuth-only users have no passwordHash; reject credentials login for them.
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user?.passwordHash || !ok) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        sessionVersion: user.sessionVersion,
      };
    },
  }),
];

if (process.env.GITHUB_ID && process.env.GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  );
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT sessions, bounded in time (M3) and revalidated against the user's
  // sessionVersion on every read so deletion/revocation takes effect at once.
  session: { strategy: "jwt", maxAge: sessionMaxAgeSeconds(), updateAge: 60 * 60 },
  trustHost: true,
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    async signIn({ account }) {
      if (account?.type === "credentials" || publicRegistrationEnabled()) return true;
      // A private installation permits existing linked OAuth accounts only;
      // merely configuring a provider must not reopen public registration.
      if (!account) return false;
      return Boolean(await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
        select: { id: true },
      }));
    },
    jwt: jwtCallback,
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id ?? token.sub) as string;
      }
      return session;
    },
  },
});
