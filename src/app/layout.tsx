import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { LogoMark, Wordmark } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import { TextSizeToggle } from "@/components/TextSizeToggle";
import { getRecipient } from "@/lib/repo";
import { LARGE_TEXT_SCRIPT } from "@/lib/text-size";
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
    // The large-text script may add a class to <html> before React hydrates; that difference is expected.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LARGE_TEXT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <div
          role="note"
          aria-label="Safety notice"
          data-testid="safety-banner"
          className="sticky top-0 z-50 border-b border-amber-200 bg-warn-soft px-4 py-2 text-center text-sm text-warn shadow-sm print:static print:border-black"
        >
          <strong>Not medical advice.</strong>
          <span className="hidden sm:inline">
            {" "}
            Carepool shows what each medicine&apos;s FDA label says, in plain words, with the label&apos;s exact text beside it.
          </span>{" "}
          Always confirm medicines, doses and interactions with a pharmacist or doctor.
        </div>
        {mock ? (
          <div data-testid="mock-banner" className="bg-danger px-4 py-1.5 text-center text-sm font-semibold text-white print:border print:border-black">
            MOCK MODE: cards and explanations are written by a scripted template for testing, not by a model.
          </div>
        ) : null}
        <header className="border-b border-line bg-card print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2.5 rounded-lg" data-testid="brand">
              <LogoMark />
              <Wordmark />
              <span className="sr-only">Carepool</span>
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <NavLinks />
              <TextSizeToggle />
            </div>
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
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-muted print:hidden">
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
