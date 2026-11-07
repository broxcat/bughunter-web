"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

/**
 * Presentational dashboard nav. Reads the current pathname only to paint the
 * BRAND accent on the active item — no routing/fetch logic of its own.
 */
export default function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="app-nav flex flex-wrap items-center gap-1 text-sm">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname?.startsWith(`${item.href}/`) ||
          (item.href === '/targets' && pathname?.startsWith('/hosts/')) ||
          (item.href === '/research' && (pathname === '/hunt' || pathname?.startsWith('/hunt/')));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-sm px-2 py-2 font-medium transition-colors",
              active
                ? "bg-brand/10 text-brand"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
