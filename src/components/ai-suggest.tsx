"use client";

import { useRef, useState } from "react";
import { suggestFormAction } from "@/app/actions";
import { Spinner } from "./action-form";

type FormKind = "campaign" | "brief" | "client";
const SUGGESTABLE_SELECTS = ["goal", "cta"];

/**
 * Fields marked `data-ai-required="Label"` must have a value before the AI can suggest anything
 * (e.g. the client: without it there is nothing to base suggestions on). Returns the empty ones.
 */
export function missingForAI(form: HTMLFormElement) {
  return [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-ai-required]")].filter((el) => !el.value.trim());
}

export const needsMessage = (missing: HTMLElement[]) =>
  `AI needs ${listLabels(missing.map((el) => el.dataset.aiRequired!))} first. Fill ${missing.length > 1 ? "them" : "it"} in, then try again.`;

const listLabels = (labels: string[]) => labels.map((l) => `“${l}”`).join(labels.length > 2 ? ", " : " and ");

/**
 * "✦ Fill with AI" — fills the EMPTY fields of the surrounding form with suggestions based on what the
 * system knows about the client. Filled fields are highlighted; nothing the user typed is overwritten.
 * `requires` lists the labels of the fields marked data-ai-required, shown up front so the user knows.
 */
export function AISuggest({ kind, campaignId, requires = [] }: { kind: FormKind; campaignId?: number; requires?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; notes: string[] } | null>(null);

  async function fill() {
    const form = ref.current?.closest("form");
    if (!form) return;
    const missing = missingForAI(form);
    if (missing.length) {
      missing[0].focus();
      return setMsg({ ok: false, text: needsMessage(missing), notes: [] });
    }
    const fd = new FormData(form);
    const typed: Record<string, string> = {};
    fd.forEach((v, k) => {
      if (typeof v === "string") typed[k] = v;
    });
    // Selects always have a value; treat their untouched default as "empty" so the AI can propose one.
    for (const el of form.querySelectorAll("select")) if (SUGGESTABLE_SELECTS.includes(el.name) && !el.dataset.touched) typed[el.name] = "";
    setBusy(true);
    setMsg(null);
    try {
      const r = await suggestFormAction(kind, typed, { clientId: Number(typed.client_id) || undefined, campaignId });
      if (!r.ok) return setMsg({ ok: false, text: r.message, notes: [] });
      let n = 0;
      for (const [name, value] of Object.entries(r.values)) {
        const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (!el || el.type === "hidden") continue;
        const isSelect = el instanceof HTMLSelectElement;
        if (isSelect ? !SUGGESTABLE_SELECTS.includes(name) || el.dataset.touched : el.value.trim()) continue; // never overwrite the user's input
        if (isSelect && ![...el.options].some((o) => o.value === value || o.text === value)) continue;
        el.value = value;
        el.dataset.ai = "1";
        el.title = r.sources[name] ?? "Suggested by AI";
        el.addEventListener("input", () => delete el.dataset.ai, { once: true });
        n++;
      }
      setMsg({
        ok: true,
        text: n ? `Filled ${n} field${n > 1 ? "s" : ""}${r.isMock ? " (mock provider)" : ""}. Highlighted fields are suggestions; please check them.` : "Nothing to fill: the fields are already filled, or there isn't enough information yet.",
        notes: [...new Set(Object.values(r.sources))].concat(r.skipped.map((s) => `Skipped ${s}`)),
      });
    } catch {
      setMsg({ ok: false, text: "Couldn't get suggestions. Try again.", notes: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-2 md:col-span-2" onChangeCapture={(e) => ((e.target as HTMLElement).dataset.touched = "1")}>
      <button type="button" onClick={fill} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent hover:opacity-90 disabled:opacity-60">
        {busy ? <Spinner /> : "✦"} {busy ? "Thinking…" : "Fill with AI"}
      </button>
      <span className="text-xs text-muted">
        {requires.length ? (
          <>
            Works only once <span className="font-medium text-ink">{listLabels(requires)}</span> {requires.length > 1 ? "are" : "is"} filled in. It then fills the other empty fields from what we know
            about this client. Your text is never overwritten.
          </>
        ) : (
          "Fills empty fields from what we know about this client. Your text is never overwritten."
        )}
      </span>
      {msg && (
        <div role="status" className={`w-full text-xs ${msg.ok ? "text-good" : "text-bad"}`}>
          {msg.ok ? "✓ " : "✕ "}
          {msg.text}
          {msg.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-muted">
              {msg.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
