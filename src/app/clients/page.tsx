import Link from "next/link";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import { listCampaigns, listClients } from "@/lib/creative/service";
import { latestRun } from "@/lib/autopilot";
import { getDb } from "@/lib/db";
import { ALLOWED_CTAS } from "@/lib/qc";
import { GOALS } from "@/lib/goals";
import { createAndRunAction, createClientAction } from "@/app/actions";
import { ActionForm, Spinner, Submit } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { RunSettingsFields } from "@/components/run-settings-fields";
import { AISuggest } from "@/components/ai-suggest";
import { FieldSuggest } from "@/components/field-suggest";
import { Badge, Empty, PageHeader } from "@/components/ui";

// The AI autopilot runs in the background after this page's action responds (~35s for all 7 steps).
export const maxDuration = 60;

export default async function CampaignsPage() {
  await connection();
  await syncStore();
  const clients = listClients();
  const campaigns = listCampaigns().map((k) => {
    const run = latestRun(k.id);
    const waiting = (getDb()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM ideas WHERE campaign_id = ?1 AND status = 'ai_selected')
              + (SELECT COUNT(*) FROM copy_variations WHERE campaign_id = ?1 AND is_current = 1 AND status = 'ai_selected')
              + (SELECT COUNT(*) FROM agent_outputs WHERE campaign_id = ?1 AND status IN ('pending_review','ai_selected')) AS n`,
      )
      .get(k.id) as { n: number }).n;
    return { ...k, run, waiting };
  });
  const anyRunning = campaigns.some((k) => k.run?.status === "running");

  return (
    <>
      <AutoRefresh active={anyRunning} everyMs={4000} />
      <PageHeader title="Campaigns" subtitle="Describe the campaign once. The AI runs AI Idea Generator, AI Copywriting, AI Static Creative, AI Script Writing, AI UGC Video, AI Video Editing and AI Landing Pages for you, and you approve everything at the end." />

      <section className="mb-8 rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-4 font-semibold">New campaign</h2>
        <ActionForm action={createAndRunAction} className="grid items-start gap-x-5 gap-y-4 md:grid-cols-2 *:min-w-0">
          <AISuggest kind="campaign" requires={[clients.length ? "Client" : "Client name"]} />
          {/* Existing clients: pick one (new clients are added from the Clients form below).
              No clients yet: type a name and it's created with the campaign.
              data-ai-required: "Fill with AI" / "Suggest" won't run until this has a value. */}
          {clients.length ? (
            <label>
              Client *
              <select name="client_id" required defaultValue="" data-ai-required="Client">
                <option value="" disabled>
                  Choose a client…
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Client name *
              <input type="hidden" name="client_id" value="" />
              <input name="new_client" required minLength={2} placeholder="e.g. Harbour Lights Foundation" data-ai-required="Client name" />
            </label>
          )}
          <label>
            Goal *
            <select name="goal" defaultValue="Donations">
              {GOALS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <FieldSuggest field="goal" />
          </label>
          <label>
            What are we promoting? *
            <input name="product" required minLength={3} placeholder="e.g. Monthly giving at £10/month" />
            <FieldSuggest field="product" />
          </label>
          <label>
            The offer or ask
            <input name="offer" placeholder="e.g. £10 a month, cancel anytime" />
            <FieldSuggest field="offer" />
          </label>
          <label className="md:col-span-2">
            Who is it for? *
            <input name="audience" required minLength={3} placeholder="e.g. UK adults 30–60 who have donated before" />
            <FieldSuggest field="audience" />
          </label>
          <label className="md:col-span-2">
            Facts the AI may use (one per line). It will never invent numbers or testimonials.
            <textarea name="proof_points" rows={3} placeholder={"e.g. £25 funds one night of emergency accommodation\nRegistered charity"} />
            <FieldSuggest field="proof_points" />
          </label>
          <details className="rounded-md border border-line p-4 md:col-span-2">
            <summary className="cursor-pointer text-sm font-medium text-accent">More options (optional)</summary>
            <div className="mt-4 grid items-start gap-x-5 gap-y-4 md:grid-cols-2 *:min-w-0">
              <label className="md:col-span-2">
                What stops people acting? (separate with ;)
                <input name="pain_points" placeholder="e.g. worry money goes on admin; feel one person can't help" />
                <FieldSuggest field="pain_points" />
              </label>
              <label>
                Tone
                <input name="tone" placeholder="e.g. warm, hopeful" />
                <FieldSuggest field="tone" />
              </label>
              <label>
                Button
                <select name="cta" defaultValue="Learn More">
                  {ALLOWED_CTAS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <FieldSuggest field="cta" />
              </label>
            </div>
          </details>
          <RunSettingsFields />
          <div className="flex flex-wrap items-center gap-3 pt-1 md:col-span-2">
            <Submit pending="Creating…">✦ Create &amp; let AI build it</Submit>
            <span className="text-xs text-muted">Usually under a minute. You can watch each step finish.</span>
          </div>
        </ActionForm>
      </section>

      <h2 className="mb-3 font-semibold">Your campaigns</h2>
      {campaigns.length ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((k) => {
            const running = k.run?.status === "running";
            return (
              <li key={k.id} className="min-w-0">
                <Link href={`/campaigns/${k.id}`} className="flex h-full min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface p-4 hover:border-accent">
                  <span className="line-clamp-2 font-semibold wrap-break-word" title={k.name}>
                    {k.name}
                  </span>
                  <span className="truncate text-sm text-muted" title={`${k.client_name} · ${k.objective}`}>
                    {k.client_name} · {k.objective}
                  </span>
                  <span className="mt-3">
                    {running ? (
                      <Badge tone="info">
                        <Spinner className="h-3 w-3" /> AI is building… {k.run!.steps.filter((s) => s.status === "done").length}/{k.run!.steps.length}
                      </Badge>
                    ) : k.waiting ? (
                      <Badge tone="accent">{k.waiting} waiting for your OK</Badge>
                    ) : k.run ? (
                      <Badge tone="good">✓ Approved</Badge>
                    ) : (
                      <Badge>Not started</Badge>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>No campaigns yet. Fill in the form above and the AI will build your first one.</Empty>
      )}

      <details className="mt-8 rounded-lg border border-line bg-surface p-4">
        <summary className="cursor-pointer font-semibold">Clients ({clients.length})</summary>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <ul className="space-y-2 text-sm">
            {clients.map((c) => (
              <li key={c.id} className="rounded-md bg-surface-2 p-2">
                <span className="font-medium">{c.name}</span> {c.is_sample ? <Badge tone="warn">Sample</Badge> : null}
                <span className="block text-xs text-muted">
                  {c.campaign_count} campaign{c.campaign_count === 1 ? "" : "s"} · ad account {c.ad_accounts ?? "not linked"}
                </span>
              </li>
            ))}
            {!clients.length && <li className="text-muted">No clients yet. You can add one here or straight from the New campaign form.</li>}
          </ul>
          <ActionForm action={createClientAction} className="space-y-2">
            <p className="text-sm font-medium">Add a client with brand rules</p>
            <AISuggest kind="client" requires={["Name"]} />
            <label>
              Name *
              <input name="name" required minLength={2} data-ai-required="Name" />
            </label>
            <label>
              Sector
              <input name="sector" required minLength={2} placeholder="e.g. Charity — mental health" />
              <FieldSuggest field="sector" />
            </label>
            <label>
              Brand voice
              <input name="brand_voice" placeholder="e.g. warm, direct, never guilt-tripping" />
              <FieldSuggest field="brand_voice" />
            </label>
            <label>
              Phrases the AI must never use (one per line)
              <textarea name="banned_claims" rows={2} />
              <FieldSuggest field="banned_claims" />
            </label>
            <input type="hidden" name="brand_guidelines" value="" />
            <Submit pending="Saving…" variant="secondary">
              Add client
            </Submit>
          </ActionForm>
        </div>
      </details>
    </>
  );
}
