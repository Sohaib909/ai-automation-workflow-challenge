import type { FlowStep, StepKind } from "@/lib/agents/registry";

const STYLE: Record<StepKind, { box: string; label: string; tag: string }> = {
  in: { box: "border-line bg-surface", label: "text-muted", tag: "Input" },
  ai: { box: "border-ai/50 bg-ai-soft", label: "text-ai", tag: "AI" },
  check: { box: "border-check/50 bg-check-soft", label: "text-check", tag: "Auto check" },
  person: { box: "border-person/50 bg-person-soft", label: "text-person", tag: "Person" },
  out: { box: "border-accent/50 bg-accent-soft", label: "text-accent", tag: "Output" },
};

/** Colour-coded flow strip: who does what, left to right. Stacks vertically on small screens. */
export function AgentFlow({ steps, compact = false }: { steps: FlowStep[]; compact?: boolean }) {
  return (
    <ol className="flex flex-col gap-1 sm:flex-row sm:items-stretch sm:gap-0" aria-label="How this agent works">
      {steps.map((s, i) => (
        <li key={i} className="flex flex-col sm:flex-1 sm:flex-row sm:items-center">
          <div className={`flex-1 rounded-lg border ${STYLE[s.kind].box} ${compact ? "p-2 text-xs" : "p-2.5 text-[13px]"} leading-snug`}>
            <div className={`text-[10px] font-semibold tracking-wide uppercase ${STYLE[s.kind].label}`}>{STYLE[s.kind].tag}</div>
            {s.text}
          </div>
          {i < steps.length - 1 && (
            <span aria-hidden className="self-center px-1 text-muted sm:px-1.5">
              <span className="sm:hidden">↓</span>
              <span className="hidden sm:inline">→</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
