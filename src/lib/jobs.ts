import { buildCard } from "./cards/pipeline";
import { getEnv } from "./env";
import { explainFlags, flagsToExplain } from "./interactions/explain";
import { findInteractions, toMatchingDrug, type DrugForMatching } from "./interactions/match";
import { getProvider, type Provider } from "./model";
import {
  failCard,
  finishRun,
  listLabels,
  listMeds,
  replaceExplanations,
  saveCard,
  saveLabel,
  setCardStatus,
  startRun,
} from "./repo";

/**
 * Card generation for the medicines on file: each card runs through the
 * pipeline (label → write → check → repair → review), then the
 * deterministic matcher runs over every stored label and the model explains
 * the flags it found. One run at a time per process.
 */

export interface GenerationResult {
  run_id: string;
  ready: string[];
  failed: { med_id: string; error: string }[];
  explanations: number;
  note: string | null;
}

const g = globalThis as unknown as { __cpGeneration?: Promise<GenerationResult> | null };

export function isGenerating(): boolean {
  return Boolean(g.__cpGeneration);
}

export async function runGeneration(opts: { medIds?: string[]; provider?: Provider; log?: (line: string) => void } = {}): Promise<GenerationResult> {
  const env = getEnv();
  const provider = opts.provider ?? getProvider();
  const log = opts.log ?? (() => {});
  const meds = listMeds().filter((m) => !opts.medIds || opts.medIds.includes(m.id));
  const runId = startRun(provider.name);
  meds.forEach((m) => setCardStatus(m.id, "queued", "Waiting"));

  const result: GenerationResult = { run_id: runId, ready: [], failed: [], explanations: 0, note: null };
  await Promise.all(
    meds.map(async (med) => {
      try {
        const { card, resolved } = await buildCard(
          { medKey: med.id, typedName: med.name },
          {
            provider,
            reviewEnabled: env.REVIEW_ENABLED,
            maxRepairRounds: env.MAX_REPAIR_ROUNDS,
            onStep: (step) => {
              setCardStatus(med.id, "running", step);
              log(`${med.name}: ${step}`);
            },
          },
        );
        saveLabel(med.id, resolved);
        saveCard(med.id, card);
        result.ready.push(med.id);
      } catch (err) {
        const message = (err as Error).message;
        failCard(med.id, message);
        result.failed.push({ med_id: med.id, error: message });
        log(`${med.name}: FAILED ${message}`);
      }
    }),
  );

  // Explanations for the deterministic flags, over every medicine with a label.
  try {
    const labels = listLabels();
    const drugs: DrugForMatching[] = listMeds()
      .filter((m) => labels.has(m.id))
      .map((m) => toMatchingDrug(m.id, m.name, labels.get(m.id)!.label, labels.get(m.id)!.classes));
    const flags = flagsToExplain(findInteractions(drugs));
    log(`Interactions: ${flags.length} flag(s) to explain`);
    const explained = await explainFlags(flags, new Map(drugs.map((d) => [d.key, d])), provider);
    replaceExplanations(
      explained.explanations.map((e) => ({ ...e, model: explained.model })),
      provider.name,
    );
    result.explanations = explained.explanations.length;
    if (explained.dropped.length > 0) result.note = `${explained.dropped.length} explanation(s) failed the quote check and were not shown.`;
  } catch (err) {
    result.note = `Flags are shown, but their explanations could not be written: ${(err as Error).message.slice(0, 200)}`;
    log(result.note);
  }

  finishRun(runId, result.failed.length === meds.length && meds.length > 0 ? "failed" : "done", result.note);
  return result;
}

/** Start a run in the background (for the web app). Refuses while one is running. */
export function startGeneration(opts: { medIds?: string[] } = {}): { started: boolean; reason?: string } {
  if (g.__cpGeneration) return { started: false, reason: "Cards are already being made." };
  if (listMeds().length === 0) return { started: false, reason: "Add a medicine first." };
  g.__cpGeneration = runGeneration(opts).finally(() => {
    g.__cpGeneration = null;
  });
  g.__cpGeneration.catch(() => {});
  return { started: true };
}
