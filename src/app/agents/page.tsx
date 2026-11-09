import Link from "next/link";
import { AGENTS } from "@/lib/agents/registry";
import { AgentFlow } from "@/components/agent-flow";
import { Badge, PageHeader } from "@/components/ui";

export default function AgentsHub() {
  return (
    <>
      <PageHeader
        title="AI agents"
        subtitle="Nine agents, one connected workflow. Each one drafts with AI, runs automatic checks, and waits for a person to approve before anything moves on."
      />
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <Badge tone="good">Working</Badge> fully usable in this prototype
        </span>
        <span className="flex items-center gap-1.5">
          <Badge tone="info">Planning works</Badge> AI produces the plan; the paid media render service isn&apos;t connected yet
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {AGENTS.map((a, i) => (
          <Link key={a.slug} href={a.href ?? `/agents/${a.slug}`} className="group rounded-lg border border-line bg-surface p-4 hover:border-accent">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted tabular">{i + 1}</span>
              <h2 className="font-semibold group-hover:text-accent">{a.name}</h2>
              {a.status === "live" ? <Badge tone="good">Working</Badge> : <Badge tone="info">Planning works</Badge>}
            </div>
            <p className="mb-3 text-sm text-muted">{a.short}</p>
            <AgentFlow steps={a.flow} compact />
            <p className="mt-3 text-sm font-medium text-accent">Open {a.name} →</p>
          </Link>
        ))}
      </div>
    </>
  );
}
