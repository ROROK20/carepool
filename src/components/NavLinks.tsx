"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/meds", label: "Medicines" },
  { href: "/interactions", label: "Interactions" },
  { href: "/schedule", label: "Schedule" },
  { href: "/circle", label: "Care circle" },
  { href: "/sheet", label: "Visit sheet" },
  { href: "/how-it-works", label: "How it works" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href) || (l.href === "/circle" && path.startsWith("/today"));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${active ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
