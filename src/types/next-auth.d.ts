import type { DefaultSession } from "next-auth";

// Expose the user id on the session, both server-side (`auth()`) and client-side
// (`useSession()`). The id is set in the jwt/session callbacks in `@/lib/auth`.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
