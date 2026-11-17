import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";
import { getRecipient } from "@/lib/repo";
import { providerName } from "@/lib/views";

export const metadata: Metadata = {
  title: "Carepool: family medicine coordinator",
  description: "Plain-language medicine cards that quote the FDA label, label-stated interaction flags, and a care circle that shares the work.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const recipient = getRecipient();
  const mock = providerName() === "mock";
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div
          role="note"
          aria-label="Safety notice"
          data-testid="safety-banner"
          className="sticky top-0 z-50 border-b border-amber-200 bg-warn-soft px-4 py-2 text-center text-sm text-warn shadow-sm"
        >
          <strong>Not medical advice.</strong>
          <span className="hidden sm:inline">
            {" "}
            Carepool shows what each medicine&apos;s FDA label says, in plain words, with the label&apos;s exact text beside it.
          </span>{" "}
          Always confirm medicines, doses and interactions with a pharmacist or doctor.
        </div>
        {mock ? (
          <div data-testid="mock-banner" className="bg-danger px-4 py-1.5 text-center text-sm font-semibold text-white">
            MOCK MODE: cards and explanations are written by a scripted template for testing, not by a model.
          </div>
        ) : null}
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
              <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
                </svg>
              </span>
              Carepool
            </Link>
            <NavLinks />
          </div>
        </header>
        {recipient?.fictional ? (
          <div data-testid="fictional-banner" className="mx-auto mt-3 max-w-5xl px-4">
            <p className="rounded-xl border border-line bg-card px-3 py-2 text-xs text-muted">
              <strong className="text-ink">Demo data:</strong> {recipient.name} and her family are fictional. The medicines and doses are an example typed the way a family member would copy them from bottles.
            </p>
          </div>
        ) : null}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-muted">
          <p>
            Label text from openFDA (U.S. Food and Drug Administration, public domain), cached locally with each label&apos;s version and date. Cards are drafted by Claude
            through the local Claude Code CLI and checked by code: every sentence must quote its label section word for word. Interaction flags come from code, not the model.
            Carepool runs only on this computer.
          </p>
        </footer>
      </body>
    </html>
  );
}
