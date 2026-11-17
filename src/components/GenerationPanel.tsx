"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateCardsAction } from "@/app/actions";
import { buttonClass } from "./ui";

interface Status {
  running: boolean;
  run: { status: string; provider: string; note: string | null } | null;
  cards: { med_id: string; name: string; status: string; step: string | null; error: string | null }[];
}

/** "Make the cards" button with live per-medicine progress. Polls /api/status while a run is going. */
export function GenerationPanel({ label = "Make the medicine cards", medId, initiallyRunning = false }: { label?: string; medId?: string; initiallyRunning?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [polling, setPolling] = useState(initiallyRunning);
  const [message, setMessage] = useState<string | null>(null);
  const wasRunning = useRef(initiallyRunning);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const body = (await res.json()) as Status;
      setStatus(body);
      if (wasRunning.current && !body.running) {
        setPolling(false);
        router.refresh();
      }
      wasRunning.current = body.running;
    } catch {
      /* the dev server can be slow under load; try again on the next tick */
    }
  }, [router]);

  useEffect(() => {
    if (!polling) return;
    void poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, [polling, poll]);

  async function start() {
    setMessage(null);
    const form = new FormData();
    if (medId) form.set("med_id", medId);
    const r = await generateCardsAction(form);
    if (!r.ok) setMessage(r.message);
    wasRunning.current = true;
    setPolling(true);
  }

  const running = polling && (status?.running ?? true);
  const visible = (status?.cards ?? []).filter((c) => !medId || c.med_id === medId);
  return (
    <div className="space-y-3">
      <button type="button" onClick={start} disabled={running} className={buttonClass.primary} data-testid="generate-button">
        {running ? "Working…" : label}
      </button>
      {message ? <p className="text-sm text-danger">{message}</p> : null}
      {running && visible.length > 0 ? (
        <ul className="space-y-1 text-sm" aria-live="polite" data-testid="generation-progress">
          {visible.map((c) => (
            <li key={c.med_id} className="flex gap-2">
              <span className="font-semibold">{c.name}:</span>
              <span className="text-muted">{c.status === "ready" ? "Card ready" : c.status === "failed" ? `Failed: ${c.error}` : (c.step ?? "Waiting")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {running && status?.run?.provider === "claude-cli" ? (
        <p className="text-xs text-muted">Each step is a call to Claude through the Claude Code CLI on this computer. A card usually takes one to two minutes.</p>
      ) : null}
    </div>
  );
}
