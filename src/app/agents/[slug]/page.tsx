import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import { AGENTS, PRODUCTION_AGENTS, type ProductionAgent, agentBySlug } from "@/lib/agents/registry";
import { SPECS, type StaticOut } from "@/lib/agents/specs";
import { withLiveImages } from "@/lib/images";
import * as agents from "@/lib/agents/service";
import * as creative from "@/lib/creative/service";
import type { QCFlag } from "@/lib/qc";
import { decideAgentOutputAction, generateAgentAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { AgentFlow } from "@/components/agent-flow";
import { EditView, LandingView, ScriptView, StaticView, UgcView } from "@/components/agent-views";
import { Badge, Card, Empty, LinkButton, PageHeader, ProviderBadge, QCList, StatusBadge, fmtDate } from "@/components/ui";

const NEXT_STEP: Partial<Record<ProductionAgent, { slug: string; label: string }[]>> = {
  script: [
    { slug: "ugc", label: "Make a UGC production pack" },
    { slug: "edit", label: "Plan the video edit" },
  ],
};

// The AI autopilot runs in the background after this page's action responds (~35s for all 7 steps).
export const maxDuration = 60;

export default async function AgentPage({ params, searchParams }: PageProps<"/agents/[slug]">) {
  await connection();
  await syncStore();
  const { slug } = await params;
  const agent = agentBySlug(slug);
  if (!agent) notFound();
  if (agent.href) redirect(agent.href);

  const sp = await searchParams;
  const campaigns = creative.listCampaigns();
  const campaignId = Number(sp.campaign) || (campaigns.length === 1 ? campaigns[0].id : 0);
  const campaign = campaigns.find((k) => k.id === campaignId);
  const isProduction = (PRODUCTION_AGENTS as readonly string[]).includes(slug);
  const idx = AGENTS.findIndex((a) => a.slug === slug);

  return (
    <>
      <PageHeader title={agent.name} subtitle={agent.short}>
        {agent.status === "live" ? <Badge tone="good">Working</Badge> : <Badge tone="info">Planning works · rendering not connected</Badge>}
      </PageHeader>

      {agent.notConnected && <p className="mb-4 rounded-lg border border-info/40 bg-info-soft p-3 text-sm text-info">{agent.notConnected}</p>}

      <Card title="How it works" className="mb-4">
        <AgentFlow steps={agent.flow} />
        <p className="mt-3 text-xs text-muted">
          <strong className="text-ink">Human control:</strong> {agent.humanGate}
        </p>
      </Card>

      {/* Step 1 — campaign */}
      <Card title={<StepTitle n={1} text="Choose a campaign" />} className="mb-4">
        {campaigns.length ? (
          <div className="flex flex-wrap gap-2">
            {campaigns.map((k) => {
              const href = isProduction ? `/agents/${slug}?campaign=${k.id}` : `/campaigns/${k.id}#${slug}`;
              const on = k.id === campaignId && isProduction;
              return (
                <Link
                  key={k.id}
                  href={href}
                  aria-current={on ? "true" : undefined}
                  className={`rounded-lg border px-3 py-2 text-sm ${on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
                >
                  <span className="font-medium">{k.name}</span>
                  <span className="block text-xs text-muted">
                    {k.client_name} · {k.approved_ideas} approved idea{k.approved_ideas === 1 ? "" : "s"}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <Empty>
            No campaigns yet. <Link href="/clients" className="text-accent">Create a campaign and add its brief →</Link>
          </Empty>
        )}
        {!isProduction && campaigns.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {agent.name} works inside the campaign page, next to the brief. Pick a campaign above to open it.
          </p>
        )}
      </Card>

      {isProduction && campaign && <ProductionWorkspace agent={slug as ProductionAgent} campaignId={campaign.id} clientName={campaign.client_name} />}

      <nav className="mt-6 flex justify-between text-sm" aria-label="Agents">
        {idx > 0 ? <Link href={`/agents/${AGENTS[idx - 1].slug}`} className="text-accent">← {AGENTS[idx - 1].name}</Link> : <span />}
        {idx < AGENTS.length - 1 && (
          <Link href={AGENTS[idx + 1].href ?? `/agents/${AGENTS[idx + 1].slug}`} className="text-accent">
            {AGENTS[idx + 1].name} →
          </Link>
        )}
      </nav>
    </>
  );
}

function StepTitle({ n, text }: { n: number; text: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-white">{n}</span>
      {text}
    </span>
  );
}

function ProductionWorkspace({ agent, campaignId, clientName }: { agent: ProductionAgent; campaignId: number; clientName: string }) {
  const spec = SPECS[agent];
  const ideas = creative.listIdeas(campaignId).filter((i) => ["approved", "ai_selected"].includes(i.status));
  const copy = agents.approvedCopy(campaignId);
  const scripts = agents.approvedScripts(campaignId);
  const outputs = agents.listOutputs(agent, campaignId);
  const ideaTitle = new Map(creative.listIdeas(campaignId).map((i) => [i.id, i.title]));
  const copyById = new Map(copy.map((c) => [c.id, c]));

  const missing =
    spec.needs === "script"
      ? !scripts.length && { text: "This agent works from an approved script, and this campaign doesn't have one yet.", href: `/agents/script?campaign=${campaignId}`, cta: "Write a script" }
      : !ideas.length
        ? { text: "This agent works from an approved idea, and this campaign doesn't have one yet.", href: `/campaigns/${campaignId}#ideas`, cta: "Generate and approve ideas" }
        : spec.needs === "idea_copy" && !copy.length
          ? { text: "This agent also needs approved ad copy, so the headline and button match the ad.", href: `/campaigns/${campaignId}#copy`, cta: "Write and approve copy" }
          : null;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/campaigns/${campaignId}`} className="text-accent">
          ← Back to the campaign workspace
        </Link>
      </p>
      <Card title={<StepTitle n={2} text="Choose what to build from, then generate" />} className="mb-4">
        {missing ? (
          <div className="rounded-md bg-warn-soft p-3 text-sm text-warn">
            {missing.text}{" "}
            <Link href={missing.href} className="font-semibold underline">
              {missing.cta} →
            </Link>
          </div>
        ) : (
          <ActionForm action={generateAgentAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="agent" value={agent} />
            {spec.needs === "script" ? (
              <label className="md:col-span-2">
                Approved script
                <select name="script_id">
                  {scripts.map((s) => (
                    <option key={s.id} value={s.id}>
                      Script #{s.id}: {(JSON.parse(s.content_json) as { title: string }).title} (idea: {s.idea_title})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className={spec.needs === "idea" ? "md:col-span-2" : ""}>
                Approved idea
                <select name="idea_id">
                  {ideas.map((i) => (
                    <option key={i.id} value={i.id}>
                      #{i.id} {i.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {spec.needs === "idea_copy" && (
              <label>
                Approved ad copy (headline · button)
                <select name="copy_id">
                  {copy.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.id} {c.headline} · {c.cta}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {spec.options.map((o) => (
              <label key={o.name}>
                {o.label}
                <select name={`opt_${o.name}`} defaultValue={o.default}>
                  {o.choices.map((c) => (
                    <option key={c} value={c}>
                      {o.name === "duration" ? `${c} seconds` : c}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              <Submit pending="Generating with AI… this can take up to a minute">Generate</Submit>
              <span className="text-xs text-muted">The result appears below as a draft. Nothing is used until you approve it.</span>
            </div>
          </ActionForm>
        )}
      </Card>

      <Card title={<StepTitle n={3} text={`Review and approve · ${outputs.length} result${outputs.length === 1 ? "" : "s"}`} />}>
        {outputs.length ? (
          <div className="space-y-4">
            {outputs.map((o) => {
              const raw = JSON.parse(o.content_json);
              const content = agent === "static" ? withLiveImages(raw as StaticOut) : raw;
              const qc = JSON.parse(o.qc_json) as QCFlag[];
              const options = JSON.parse(o.options_json) as Record<string, string>;
              const c = o.source_copy_id ? copyById.get(o.source_copy_id) : undefined;
              return (
                <article key={o.id} className="rounded-lg border border-line p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="font-semibold">#{o.id}</span>
                    <StatusBadge status={o.status} />
                    <ProviderBadge provider={o.provider} model={o.model} />
                    <span className="text-xs text-muted">
                      From idea “{ideaTitle.get(o.idea_id)}”{o.source_output_id ? ` · script #${o.source_output_id}` : ""}
                      {c ? ` · copy #${c.id}` : ""} · {Object.values(options).join(" · ")} · {fmtDate(o.created_at)}
                    </span>
                  </div>
                  {agent === "script" && <ScriptView o={content} />}
                  {agent === "static" && <StaticView o={content} outputId={o.id} headline={c?.headline} subline={c?.description} cta={c?.cta} brand={clientName} />}
                  {agent === "ugc" && <UgcView o={content} />}
                  {agent === "edit" && <EditView o={content} />}
                  {agent === "landing" && <LandingView o={content} brand={clientName} />}
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold text-muted uppercase">Automatic checks</p>
                    <QCList flags={qc} />
                  </div>
                  {o.status === "approved" && NEXT_STEP[agent] && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-good-soft p-2 text-sm text-good">
                      Approved. Next:
                      {NEXT_STEP[agent]!.map((n) => (
                        <LinkButton key={n.slug} href={`/agents/${n.slug}?campaign=${campaignId}`}>
                          {n.label} →
                        </LinkButton>
                      ))}
                    </div>
                  )}
                  <ActionForm action={decideAgentOutputAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                    <input type="hidden" name="output_id" value={o.id} />
                    <input name="comment" placeholder="Comment (needed if you reject or ask for changes)" className="min-w-48 flex-1" aria-label="Reviewer comment" />
                    {o.status !== "approved" && (
                      <Submit name="decision" value="approve" pending="Approving…">
                        Approve
                      </Submit>
                    )}
                    <Submit name="decision" value="request_changes" variant="secondary" pending="Saving…">
                      Request changes
                    </Submit>
                    {o.status !== "rejected" && (
                      <Submit name="decision" value="reject" variant="danger" pending="Rejecting…">
                        Reject
                      </Submit>
                    )}
                  </ActionForm>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty>Nothing generated yet for this campaign. Use step 2 above.</Empty>
        )}
      </Card>
    </>
  );
}
