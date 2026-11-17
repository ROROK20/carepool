import Link from "next/link";
import type { ReactNode } from "react";

/** Small shared building blocks. Server components; no client state. */

export function PageTitle({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      {kicker ? <p className="text-sm font-semibold uppercase tracking-wide text-accent">{kicker}</p> : null}
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">{title}</h1>
      {children ? <div className="mt-2 max-w-3xl text-muted">{children}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-5 shadow-sm ${className}`}>{children}</section>;
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-3 text-xl font-semibold text-ink">
      {children}
    </h2>
  );
}

const PILL: Record<string, string> = {
  ready: "bg-ok-soft text-ok",
  done: "bg-ok-soft text-ok",
  verified: "bg-ok-soft text-ok",
  running: "bg-accent-soft text-accent-strong",
  queued: "bg-accent-soft text-accent-strong",
  covered: "bg-accent-soft text-accent-strong",
  failed: "bg-danger-soft text-danger",
  removed: "bg-danger-soft text-danger",
  needs_cover: "bg-warn-soft text-warn",
  flag: "bg-warn-soft text-warn",
  open: "bg-stone-100 text-stone-700",
  none: "bg-stone-100 text-stone-700",
  mock: "bg-danger-soft text-danger",
};

export function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[kind] ?? PILL.none}`}>{children}</span>;
}

const DOT: Record<string, string> = {
  teal: "bg-teal-600",
  amber: "bg-amber-500",
  violet: "bg-violet-600",
  rose: "bg-rose-500",
  sky: "bg-sky-600",
};
export const MEMBER_COLORS = Object.keys(DOT);

export function Avatar({ name, color, size = "md" }: { name: string; color: string; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-6 w-6 text-xs" : "h-9 w-9 text-sm";
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${dim} ${DOT[color] ?? DOT.teal}`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "quiet" }) {
  const cls =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-strong"
      : "border border-line bg-card text-ink hover:border-accent hover:text-accent";
  return (
    <Link href={href} className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold ${cls}`}>
      {children}
    </Link>
  );
}

export const buttonClass = {
  primary: "inline-flex items-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60",
  quiet: "inline-flex items-center rounded-xl border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent",
  danger: "inline-flex items-center rounded-xl border border-line bg-card px-3 py-1.5 text-sm font-semibold text-danger hover:border-danger",
};

export const inputClass = "w-full rounded-xl border border-line bg-white px-3 py-2 text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none";
