"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted">{error.message}</p>
      <button type="button" onClick={reset} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
