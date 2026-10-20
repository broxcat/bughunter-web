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
    <nav className="flex items-center gap-1 text-sm">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-md px-3 py-1.5 font-medium transition-colors",
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
