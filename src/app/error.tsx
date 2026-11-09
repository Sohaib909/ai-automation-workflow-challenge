"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold text-bad">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error.digest ? `Reference: ${error.digest}` : error.message}</p>
      <button onClick={reset} className="mt-4 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
        Try again
      </button>
    </div>
  );
}
