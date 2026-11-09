"use client";

import { useRef, useState } from "react";
import { suggestFieldAction } from "@/app/actions";
import { Spinner } from "./action-form";
import { missingForAI, needsMessage } from "./ai-suggest";

type Result = Awaited<ReturnType<typeof suggestFieldAction>>;

/**
 * "✦ Suggest" under a single field: shows up to 3 options as chips; clicking one puts it in the field
 * (facts are added as a new line instead). Uses the same client history and guards as "Fill with AI".
 */
export function FieldSuggest({ field, campaignId }: { field: string; campaignId?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const form = () => ref.current?.closest("form") ?? null;

  async function suggest() {
    const f = form();
    if (!f) return;
    const missing = missingForAI(f);
    if (missing.length) {
      missing[0].focus();
      return setRes({ ok: false, message: needsMessage(missing), options: [], source: "", skipped: 0, isMock: false, mode: "replace" });
    }
    const typed: Record<string, string> = {};
    new FormData(f).forEach((v, k) => {
      if (typeof v === "string") typed[k] = v;
    });
    setBusy(true);
    setPicked(null);
    try {
      setRes(await suggestFieldAction(field, typed, { clientId: Number(typed.client_id) || undefined, campaignId }));
    } catch {
      setRes({ ok: false, message: "Couldn't get suggestions. Try again.", options: [], source: "", skipped: 0, isMock: false, mode: "replace" });
    } finally {
      setBusy(false);
    }
  }

  function use(option: string) {
    const el = form()?.elements.namedItem(field) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el) return;
    if (res?.mode === "append") {
      const lines = el.value.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.includes(option)) el.value = [...lines, option].join("\n");
    } else {
      el.value = option;
    }
    el.dataset.ai = "1";
    el.dataset.touched = "1";
    el.addEventListener("input", () => delete el.dataset.ai, { once: true });
    setPicked(option);
  }

  return (
    <div ref={ref} className="mt-1">
      <button
        type="button"
        onClick={suggest}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded px-1 text-[11px] font-medium text-accent hover:bg-accent-soft disabled:opacity-60"
        aria-label={`Suggest options for this field`}
      >
        {busy ? <Spinner className="h-3 w-3" /> : "✦"} {busy ? "Thinking…" : res ? "More suggestions" : "Suggest"}
      </button>
      {res && !busy && (
        <div className="mt-1" role="status">
          {!res.ok ? (
            <p className="text-[11px] text-bad">✕ {res.message}</p>
          ) : res.options.length ? (
            <>
              <div className="flex flex-wrap gap-1">
                {res.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => use(o)}
                    title={res.mode === "append" ? "Add this fact" : "Use this"}
                    className={`max-w-full rounded-full border px-2 py-0.5 text-left text-[12px] whitespace-pre-line ${picked === o ? "border-accent bg-accent text-white" : "border-accent/40 bg-accent-soft text-ink hover:border-accent"}`}
                  >
                    {res.mode === "append" ? "+ " : ""}
                    {o}
                  </button>
                ))}
              </div>
              <p className="mt-0.5 text-[10px] text-muted">
                {res.source}
                {res.skipped ? ` · ${res.skipped} option(s) hidden because they used numbers not in your data` : ""}
                {res.isMock ? " · mock provider" : ""}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted">{res.source || "No suggestions yet. Add a bit more information first."}</p>
          )}
        </div>
      )}
    </div>
  );
}
