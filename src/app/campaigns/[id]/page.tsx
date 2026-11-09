import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import type { ReactNode } from "react";
import * as svc from "@/lib/creative/service";
import * as agents from "@/lib/agents/service";
import { latestRun, stepLabel } from "@/lib/autopilot";
import { TOOL_NAMES } from "@/lib/tool-names";
import { ALLOWED_CTAS, type QCFlag } from "@/lib/qc";
import type { ProductionAgent } from "@/lib/agents/registry";
import type { StaticOut } from "@/lib/agents/specs";
import { imagesEnabled, withLiveImages } from "@/lib/images";
import {
  approveAllAction,
  decideAgentOutputAction,
  decideCopyAction,
  decideIdeaAction,
  editCopyAction,
  regenerateAgentAction,
  regenerateCopyAction,
  regenerateIdeaAction,
  rerunAction,
  saveBriefAction,
} from "@/app/actions";
import { ActionForm, Spinner, Submit } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { RunSettingsFields } from "@/components/run-settings-fields";
import { parseSettings } from "@/lib/run-settings";
import { AISuggest } from "@/components/ai-suggest";
import { FieldSuggest } from "@/components/field-suggest";
import { EditView, LandingView, ScriptView, StaticView, UgcView } from "@/components/agent-views";
import { QCSummary, ReviewBar } from "@/components/review";
import { Empty, StatusBadge } from "@/components/ui";

const WAITING = ["pending_review", "ai_selected"];

// The AI autopilot runs in the background after this page's action responds (~35s for all 7 steps).
export const maxDuration = 60;

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  await connection();
  await syncStore();
  const { id } = await params;
  const campaign = svc.getCampaign(Number(id));
  if (!campaign) notFound();
  const client = svc.getClient(campaign.client_id)!;
  const brief = svc.latestBrief(campaign.id);
  const run = latestRun(campaign.id);
  const running = run?.status === "running";

  const ideas = svc.listIdeas(campaign.id);
  const copy = svc.listCopy(campaign.id);
  const out = (a: ProductionAgent) => agents.listOutputs(a, campaign.id);
  const outputs = { static: out("static"), script: out("script"), ugc: out("ugc"), edit: out("edit"), landing: out("landing") };
  const all = [...ideas.filter((i) => i.status === "ai_selected" || i.status === "approved"), ...copy.filter((c) => c.status === "ai_selected" || c.status === "approved"), ...Object.values(outputs).flat()];
  const toReview = all.filter((x) => WAITING.includes(x.status)).length;
  const approved = all.filter((x) => x.status === "approved").length;

  return (
    <>
      <AutoRefresh active={running} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/clients" className="text-sm text-muted hover:text-accent">
            ← All campaigns
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-muted">
            {client.name} · {campaign.objective}
          </p>
        </div>
        {approved > 0 && (
          <Link href={`/preview/${campaign.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
            👁 Preview approved work
          </Link>
        )}
      </div>

      {!running && brief && (
        <details className="mb-4 rounded-lg border border-line bg-surface p-3" open={!run}>
          <summary className="cursor-pointer text-sm font-medium">↻ Run the AI {run ? "again" : ""} · change counts and options</summary>
          <ActionForm action={rerunAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="campaign_id" value={campaign.id} />
            <RunSettingsFields value={parseSettings(campaign.settings_json)} open />
            <div className="md:col-span-2">
              <Submit pending="Starting…">✦ {run ? "Run the AI again with these settings" : "Let the AI build this campaign"}</Submit>
            </div>
          </ActionForm>
        </details>
      )}

      {/* Progress */}
      {run && (
        <section className="mb-4 rounded-lg border border-line bg-surface p-4" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              {running ? <Spinner className="h-4 w-4 text-accent" /> : run.status === "completed" ? "✓" : "!"}
              {running ? "The AI is building your campaign…" : run.status === "completed" ? "Your campaign package is ready" : "Finished, with some steps that need attention"}
            </h2>
            <span className="text-xs text-muted">
              {run.steps.filter((s) => s.status === "done").length} of {run.steps.length} steps
            </span>
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full bg-accent transition-all" style={{ width: `${(run.steps.filter((s) => s.status !== "waiting" && s.status !== "running").length / run.steps.length) * 100}%` }} />
          </div>
          <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {run.steps.map((s) => (
              <li key={s.key} className="flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-xs">
                <span className="mt-0.5 w-4 shrink-0 text-center" aria-label={s.status}>
                  {s.status === "running" ? <Spinner className="h-3.5 w-3.5 text-accent" /> : { done: "✓", failed: "✕", skipped: "–", waiting: "○" }[s.status as string]}
                </span>
                <span className="min-w-0">
                  <span className={`block font-medium ${s.status === "failed" ? "text-bad" : s.status === "waiting" ? "text-muted" : ""}`}>{stepLabel(s)}</span>
                  {s.detail && <span className="block text-muted">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!brief && (
        <Empty>
          This campaign has no brief yet. <BriefEditor campaignId={campaign.id} />
        </Empty>
      )}

      {/* One review gate */}
      {!running && all.length > 0 && (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent-soft p-4">
          <div>
            <p className="font-semibold">{toReview ? `${toReview} item${toReview === 1 ? "" : "s"} waiting for your OK` : "Everything is approved ✓"}</p>
            <p className="text-sm text-muted">
              {toReview ? "Look through the package below. Approve everything in one go, or regenerate any piece with a note." : `${approved} approved items. Nothing is published automatically.`}
            </p>
          </div>
          {toReview > 0 && (
            <ActionForm action={approveAllAction}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <Submit pending="Approving…">✓ Approve all</Submit>
            </ActionForm>
          )}
        </section>
      )}

      <div className="space-y-4">
        <IdeaSection ideas={ideas} />
        <CopySection copy={copy} campaignId={campaign.id} />
        <OutputSection title={TOOL_NAMES.static} agent="static" rows={outputs.static} brand={client.name} copy={copy} running={running} />
        <OutputSection title={TOOL_NAMES.script} agent="script" rows={outputs.script} brand={client.name} copy={copy} running={running} />
        <OutputSection title={TOOL_NAMES.ugc} agent="ugc" rows={outputs.ugc} brand={client.name} copy={copy} running={running} />
        <OutputSection title={TOOL_NAMES.edit} agent="edit" rows={outputs.edit} brand={client.name} copy={copy} running={running} />
        <OutputSection title={TOOL_NAMES.landing} agent="landing" rows={outputs.landing} brand={client.name} copy={copy} running={running} />
      </div>

      {brief && (
        <details className="mt-6 rounded-lg border border-line bg-surface p-4">
          <summary className="cursor-pointer font-semibold">Brief (what the AI was told)</summary>
          <p className="mt-2 text-sm text-muted">
            {brief.product} · for {brief.audience}
            {brief.offer && ` · ${brief.offer}`}
          </p>
          <BriefEditor campaignId={campaign.id} brief={brief} />
        </details>
      )}

      <p className="mt-6 text-sm text-muted">
        After launch, see how the ads perform in{" "}
        <Link href={`/toast?client=${client.id}`} className="text-accent">
          {TOOL_NAMES.toast}
        </Link>
        . Lessons you accept there feed the next AI run for this client.
      </p>
    </>
  );
}

function Section({ title, status, children, extra }: { title: string; status?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          {title} {status && <StatusBadge status={status} />}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

/* ---------- Idea ---------- */
function IdeaSection({ ideas }: { ideas: svc.IdeaRow[] }) {
  const pick = ideas.find((i) => i.status === "ai_selected") ?? ideas.find((i) => i.status === "approved");
  if (!pick) return null;
  const others = ideas.filter((i) => i.id !== pick.id);
  return (
    <Section title={TOOL_NAMES.ideas} status={pick.status} extra={<span className="text-xs text-muted">Score {Math.round(pick.total_score)}/100</span>}>
      <p className="text-lg font-semibold">{pick.title}</p>
      <p className="mt-1">“{pick.hook}”</p>
      <p className="mt-1 text-sm text-muted">{pick.core_concept}</p>
      <QCSummary flags={JSON.parse(pick.warnings_json) as QCFlag[]} />
      <ReviewBar decide={decideIdeaAction} regenerate={regenerateIdeaAction} idName="idea_id" id={pick.id} status={pick.status} what="Regenerating the idea" />
      {others.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">Other ideas the AI considered ({others.length})</summary>
          <ul className="mt-2 space-y-2">
            {others.map((i) => (
              <li key={i.id} className="rounded-md bg-surface-2 p-2">
                <span className="font-medium">{i.title}</span> <span className="text-xs text-muted">· score {Math.round(i.total_score)}</span>
                <p className="text-muted">“{i.hook}”</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

/* ---------- Copy ---------- */
function CopySection({ copy, campaignId }: { copy: svc.CopyRow[]; campaignId: number }) {
  const pick = copy.find((c) => c.status === "ai_selected") ?? copy.find((c) => c.status === "approved");
  if (!pick) return null;
  const others = copy.filter((c) => c.id !== pick.id && c.status !== "rejected");
  const qc = JSON.parse(pick.qc_json) as QCFlag[];
  return (
    <Section
      title={TOOL_NAMES.copy}
      status={pick.status}
      extra={
        copy.some((c) => c.status === "approved") && (
          <a href={`/campaigns/${campaignId}/export`} className="text-sm text-accent">
            ↓ Download approved copy
          </a>
        )
      }
    >
      <div className="max-w-xl rounded-md border border-line bg-surface-2 p-3 text-sm">
        <p className="mb-2 whitespace-pre-line">
          <strong>{pick.hook}</strong>
          {"\n"}
          {pick.primary_text}
        </p>
        <div className="flex items-end justify-between gap-2 rounded bg-surface p-2">
          <div className="min-w-0">
            <p className="font-semibold">{pick.headline}</p>
            <p className="text-xs text-muted">{pick.description}</p>
          </div>
          <span className="shrink-0 rounded bg-surface-2 px-2 py-1 text-xs font-medium">{pick.cta}</span>
        </div>
      </div>
      <QCSummary flags={qc} />
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-xs text-muted">Edit the text yourself</summary>
        <ActionForm action={editCopyAction} className="mt-2 grid max-w-xl gap-2">
          <input type="hidden" name="copy_id" value={pick.id} />
          <label>
            Opening line
            <input name="hook" defaultValue={pick.hook} required />
          </label>
          <label>
            Main text
            <textarea name="primary_text" rows={4} defaultValue={pick.primary_text} required />
          </label>
          <label>
            Headline
            <input name="headline" defaultValue={pick.headline} required />
          </label>
          <label>
            Description
            <input name="description" defaultValue={pick.description} required />
          </label>
          <label>
            Button
            <select name="cta" defaultValue={pick.cta}>
              {ALLOWED_CTAS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div>
            <Submit pending="Saving…" variant="secondary">
              Save
            </Submit>
          </div>
        </ActionForm>
      </details>
      <ReviewBar
        decide={decideCopyAction}
        regenerate={regenerateCopyAction}
        idName="copy_id"
        id={pick.id}
        status={pick.status}
        blocked={qc.some((f) => f.level === "error")}
        what="Regenerating the copy"
      />
      {others.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">Other versions ({others.length})</summary>
          <ul className="mt-2 space-y-2">
            {others.map((c) => (
              <li key={c.id} className="rounded-md bg-surface-2 p-2">
                <strong>{c.headline}</strong> <span className="text-xs text-muted">· {c.angle}</span>
                <p className="text-muted">{c.hook}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

/* ---------- Agent outputs ---------- */
function OutputSection({
  title,
  agent,
  rows,
  brand,
  copy,
  running,
}: {
  title: string;
  agent: ProductionAgent;
  rows: agents.AgentOutputRow[];
  brand: string;
  copy: svc.CopyRow[];
  running: boolean;
}) {
  const o = rows[0];
  if (!o) return running ? null : null;
  const raw = JSON.parse(o.content_json);
  const content = agent === "static" ? withLiveImages(raw as StaticOut) : raw;
  const qc = JSON.parse(o.qc_json) as QCFlag[];
  const c = copy.find((x) => x.id === o.source_copy_id);
  return (
    <Section title={title} status={o.status} extra={<Link href={`/agents/${agent}?campaign=${o.campaign_id}`} className="text-xs text-muted hover:text-accent">Open in agent →</Link>}>
      <details open={WAITING.includes(o.status) || (agent === "static" && (content as StaticOut).concepts.some((x) => !x.images?.square || x.images.pending))}>
        <summary className="mb-2 cursor-pointer text-xs text-muted">Show / hide</summary>
        {agent === "script" && <ScriptView o={content} />}
        {agent === "static" && <StaticView o={content} outputId={o.id} headline={c?.headline} subline={c?.description} cta={c?.cta} brand={brand} autoFill={!running && imagesEnabled() && o.provider !== "mock"} />}
        {agent === "ugc" && <UgcView o={content} />}
        {agent === "edit" && <EditView o={content} />}
        {agent === "landing" && <LandingView o={content} brand={brand} />}
      </details>
      <QCSummary flags={qc} />
      <ReviewBar
        decide={decideAgentOutputAction}
        regenerate={regenerateAgentAction}
        idName="output_id"
        id={o.id}
        status={o.status}
        blocked={qc.some((f) => f.level === "error")}
        what={`Regenerating the ${title.toLowerCase()}`}
      />
    </Section>
  );
}

/* ---------- Brief ---------- */
function BriefEditor({ campaignId, brief }: { campaignId: number; brief?: svc.BriefRow }) {
  return (
    <ActionForm action={saveBriefAction} className="mt-3 grid gap-3 text-left md:grid-cols-2">
      <input type="hidden" name="campaign_id" value={campaignId} />
      <AISuggest kind="brief" campaignId={campaignId} />
      <label>
        What are we promoting? *
        <input name="product" required minLength={3} defaultValue={brief?.product} />
            <FieldSuggest field="product" campaignId={campaignId} />
      </label>
      <label>
        The offer or ask
        <input name="offer" defaultValue={brief?.offer} />
            <FieldSuggest field="offer" campaignId={campaignId} />
      </label>
      <label className="md:col-span-2">
        Who is it for? *
        <input name="audience" required minLength={3} defaultValue={brief?.audience} />
            <FieldSuggest field="audience" campaignId={campaignId} />
      </label>
      <label className="md:col-span-2">
        Facts the AI may use (one per line)
        <textarea name="proof_points" rows={3} defaultValue={brief?.proof_points} />
            <FieldSuggest field="proof_points" campaignId={campaignId} />
      </label>
      <label>
        What stops people acting?
        <input name="pain_points" defaultValue={brief?.pain_points} />
            <FieldSuggest field="pain_points" campaignId={campaignId} />
      </label>
      <label>
        Tone
        <input name="tone" defaultValue={brief?.tone} />
            <FieldSuggest field="tone" campaignId={campaignId} />
      </label>
      <input type="hidden" name="cta" value={brief?.cta || "Learn More"} />
      <div className="md:col-span-2">
        <Submit pending="Saving…" variant="secondary">
          Save brief
        </Submit>
        <span className="ml-3 text-xs text-muted">Then click “Run the AI again” to rebuild with the new brief.</span>
      </div>
    </ActionForm>
  );
}
