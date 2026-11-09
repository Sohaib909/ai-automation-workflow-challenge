import Link from "next/link";
import { type StageState, campaignWorkflow } from "@/lib/workflow";

const LOOK: Record<StageState, { box: string; icon: string; label: string }> = {
  done: { box: "border-good bg-good-soft", icon: "✓", label: "Done" },
  review: { box: "border-info bg-info-soft", icon: "●", label: "Needs review" },
  ready: { box: "border-accent bg-surface", icon: "→", label: "Ready" },
  waiting: { box: "border-dashed border-line bg-surface text-muted", icon: "○", label: "Waiting" },
};

/** End-to-end campaign workflow: every stage, its state, and the single next thing to do. */
export function WorkflowStepper({ campaignId }: { campaignId: number }) {
  const { stages, next } = campaignWorkflow(campaignId);
  const done = stages.filter((s) => s.state === "done").length;
  return (
    <section className="mb-4 rounded-lg border border-line bg-surface p-4" aria-label="Campaign workflow">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          End-to-end workflow <span className="font-normal text-muted">· {done} of {stages.length} stages done</span>
        </h2>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full bg-good" style={{ width: `${(done / stages.length) * 100}%` }} />
        </div>
      </div>
      {next && (
        <Link href={next.href} className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent hover:opacity-90">
          <strong>Next step:</strong>
          {next.state === "review" ? `Review and approve your ${next.label.toLowerCase()} (${next.detail})` : `${next.label}: ${next.detail.toLowerCase()}`}
          <span className="ml-auto font-semibold">Go →</span>
        </Link>
      )}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
        {stages.map((s, i) => (
          <li key={s.key} className="min-w-0">
            <Link
              href={s.href}
              className={`flex h-full min-w-0 flex-col rounded-md border p-2 text-xs wrap-break-word hover:shadow-sm ${LOOK[s.state].box}`}
              title={`${s.agent}: ${s.detail}`}
            >
              <span className="flex items-center justify-between text-[10px] text-muted">
                <span>Step {i + 1}</span>
                <span aria-label={LOOK[s.state].label}>{LOOK[s.state].icon}</span>
              </span>
              <span className="font-semibold text-ink">{s.label}</span>
              <span className="text-[10px] leading-tight text-muted">{s.agent}</span>
              <span className="mt-1 text-[11px]">{s.detail}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
