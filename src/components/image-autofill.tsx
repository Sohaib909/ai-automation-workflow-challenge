"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { generateConceptImageAction } from "@/app/actions";
import { Spinner } from "./action-form";

const COOLDOWN_MS = 46_000; // free image tier: one image every 45 seconds
const MAX_TRIES = 4;

type Phase = { phase: "idle" | "working" | "waiting" | "done" | "stopped"; name?: string; wait?: number; errors: string[] };

/**
 * The free image tier only allows one image every 45 seconds, so a campaign build (or a regenerate) can
 * only make the first concept's image. This fills in the rest automatically, one at a time, waiting out
 * the limit with a visible countdown. Render it with key={outputId} so a new version starts fresh.
 */
export function ImageAutoFill({ outputId, missing }: { outputId: number; missing: { index: number; name: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<Phase>({ phase: "idle", errors: [] });
  const stopped = useRef(false);
  const lastImageAt = useRef(0);
  // A stable key: the effect only restarts when the set of missing images changes, not on every refresh.
  const todoKey = missing.map((m) => `${m.index}\u0001${m.name}`).join("\u0002");

  useEffect(() => {
    let cancelled = false; // set when this run is replaced (new missing list, new version, page left)
    const live = () => !cancelled && !stopped.current;
    const todo = todoKey ? todoKey.split("\u0002").map((s) => ({ index: Number(s.split("\u0001")[0]), name: s.split("\u0001")[1] })) : [];
    const errors: string[] = [];
    const show = (s: Omit<Phase, "errors">) => live() && setState({ ...s, errors: [...errors] });
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const countdown = async (name: string, untilMs: number) => {
      while (live() && Date.now() < untilMs) {
        show({ phase: "waiting", name, wait: Math.ceil((untilMs - Date.now()) / 1000) });
        await pause(1000);
      }
    };

    (async () => {
      await pause(300); // React may mount twice in development; only the surviving run makes requests
      for (const { index, name } of todo) {
        for (let attempt = 1; attempt <= MAX_TRIES && live(); attempt++) {
          await countdown(name, lastImageAt.current + COOLDOWN_MS);
          if (!live()) return;
          show({ phase: "working", name });
          const fd = new FormData();
          fd.set("output_id", String(outputId));
          fd.set("index", String(index));
          const res = await generateConceptImageAction(null, fd).catch((e: Error) => ({ ok: false, message: e.message, rateLimited: false }));
          if (res?.ok) {
            lastImageAt.current = Date.now();
            router.refresh(); // the new missing list restarts this effect for the remaining concepts
            break;
          }
          if (res && "rateLimited" in res && res.rateLimited) {
            lastImageAt.current = Date.now();
            continue;
          }
          errors.push(`“${name}”: ${res?.message ?? "failed"}`);
          break;
        }
        if (!live()) return;
      }
      if (live()) setState({ phase: "done", errors: [...errors] });
    })();

    return () => {
      cancelled = true;
    };
  }, [todoKey, outputId, router]);

  if (!missing.length) return null;
  if (state.phase === "done" && !state.errors.length) return null;

  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-info/40 bg-info-soft px-3 py-2 text-xs text-info">
      {state.phase === "working" && (
        <span className="inline-flex items-center gap-1.5">
          <Spinner className="h-3.5 w-3.5" /> Creating the image for “{state.name}”…
        </span>
      )}
      {state.phase === "waiting" && (
        <span>
          The free image service allows one image every 45 seconds. Next image (“{state.name}”) in <strong className="tabular">{state.wait}s</strong>.
        </span>
      )}
      {state.phase === "idle" && <span>Preparing the remaining images…</span>}
      {state.phase === "stopped" && <span>Stopped. Use “Generate image” on each concept when you’re ready.</span>}
      {state.phase === "done" && <span>Finished, but some images could not be made. Use “Generate image” to try again.</span>}
      {(state.phase === "working" || state.phase === "waiting" || state.phase === "idle") && (
        <button
          type="button"
          onClick={() => {
            stopped.current = true;
            setState((s) => ({ ...s, phase: "stopped" }));
          }}
          className="ml-auto rounded border border-info/40 px-2 py-0.5 hover:bg-surface"
        >
          Stop
        </button>
      )}
      {state.errors.length > 0 && (
        <ul className="w-full list-disc pl-4 text-bad">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
