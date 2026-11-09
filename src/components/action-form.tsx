"use client";

import { type ReactNode, useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { btn } from "./ui";

export type ActionState = { ok: boolean; message: string } | null;
export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Form wrapper that shows the server action's real outcome — no optimistic "success" messages. */
export function ActionForm({ action, children, className = "" }: { action: FormAction; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state && (
        <p role={state.ok ? "status" : "alert"} className={`mt-2 w-full basis-full text-xs ${state.ok ? "text-good" : "text-bad"}`}>
          {state.ok ? "✓ " : "✕ "}
          {state.message}
        </p>
      )}
    </form>
  );
}

export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Submit({
  children,
  pending = "Working…",
  variant = "primary",
  name,
  value,
}: {
  children: ReactNode;
  pending?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  name?: string;
  value?: string;
}) {
  const { pending: isPending, data } = useFormStatus();
  // When several submit buttons share a form, only the clicked one shows the spinner.
  const mine = isPending && (!name || data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} disabled={isPending} className={btn(variant)} aria-busy={mine}>
      {mine && <Spinner />}
      {mine ? pending : children}
    </button>
  );
}

/** Shown inside an AI form while it runs: what's happening, elapsed time, and a skeleton of the result. */
export function GeneratingPanel({ what = "AI is working" }: { what?: string }) {
  const { pending } = useFormStatus();
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => {
      clearInterval(t);
      setSecs(0);
    };
  }, [pending]);
  if (!pending) return null;
  return (
    <div role="status" aria-live="polite" className="mt-3 w-full basis-full rounded-lg border border-accent/30 bg-accent-soft p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-accent">
        <Spinner className="h-4 w-4" />
        {what}… <span className="tabular font-normal">{secs}s</span>
      </div>
      <p className="mt-1 text-xs text-muted">Usually 10–60 seconds. You can keep this page open; the result appears below when it&apos;s ready.</p>
      <div className="mt-3 space-y-2" aria-hidden>
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface" />
        <div className="h-3 w-full animate-pulse rounded bg-surface" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-surface" />
      </div>
    </div>
  );
}
