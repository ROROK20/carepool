import { NextResponse } from "next/server";
import { isGenerating } from "@/lib/jobs";
import { latestRun, listCards, listMeds } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generation progress for the "Make the cards" panel. */
export function GET() {
  const cards = listCards();
  const run = latestRun();
  return NextResponse.json({
    running: isGenerating(),
    run: run ? { status: run.status, provider: run.provider, note: run.note } : null,
    cards: listMeds().map((m) => {
      const c = cards.get(m.id);
      return { med_id: m.id, name: m.name, status: c?.status ?? "none", step: c?.step ?? null, error: c?.error ?? null };
    }),
  });
}
