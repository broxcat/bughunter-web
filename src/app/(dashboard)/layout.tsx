import Link from "next/link";
import { auth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import SignOutButton from "./_components/SignOutButton";
import NavLinks from "./_components/NavLinks";

const NAV = [
  { href: "/targets", label: "Targets" },
  { href: "/scopes", label: "Scopes" },
  { href: "/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link
              href="/targets"
              className="flex items-center gap-2 font-semibold tracking-tight"
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" />
              bughunter
            </Link>
            <NavLinks items={NAV} />
          </div>
          <div className="flex items-center gap-3 text-sm">
            {session?.user?.email && (
              <span className="hidden font-mono text-subtle sm:inline">
                {session.user.email}
              </span>
            )}
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
