import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { syncStore } from "@/lib/db";
import { campaignPreview } from "@/lib/preview";
import { TOOL_NAMES } from "@/lib/tool-names";
import { FeedAdPreview, StoryAdPreview } from "@/components/ad-preview";
import { EditView, LandingView, ScriptView, UgcView } from "@/components/agent-views";
import { Badge, Empty, LinkButton } from "@/components/ui";

export default async function CampaignPreviewPage({ params }: PageProps<"/preview/[id]">) {
  await connection();
  await syncStore();
  const { id } = await params;
  const p = campaignPreview(Number(id));
  if (!p) notFound();
  const { campaign, client, adCopy } = p;
  const brand = client.name;

  // One ad per approved image concept, all using the approved copy. Copy without images still previews (brand background).
  const ads = adCopy
    ? (p.statics?.concepts.length ? p.statics.concepts : [null]).map((c, i) => ({
        key: i,
        brand,
        image: c?.images?.square ?? null,
        name: c?.name ?? "ad",
        hook: adCopy.hook,
        primaryText: adCopy.primary_text,
        headline: adCopy.headline,
        description: adCopy.description,
        cta: adCopy.cta,
        showCta: p.statics?.show_cta !== false,
      }))
    : [];
  const otherCopy = p.copy.filter((c) => c.id !== adCopy?.id);
  const hasVideo = p.script || p.ugc || p.edit;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/preview" className="text-sm text-muted hover:text-accent">
            ← All previews
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight wrap-break-word">{campaign.name}</h1>
          <p className="text-sm text-muted">
            {client.name} · {campaign.objective}
            {p.brief?.audience ? ` · For ${p.brief.audience}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.copy.length > 0 && (
            <a href={`/campaigns/${campaign.id}/export`} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
              ↓ Approved copy (CSV)
            </a>
          )}
          <LinkButton href={`/campaigns/${campaign.id}`}>Open campaign</LinkButton>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="good">✓ {p.approvedCount} approved item{p.approvedCount === 1 ? "" : "s"}</Badge>
        {p.waiting > 0 && (
          <span className="text-muted">
            {p.waiting} more {p.waiting === 1 ? "is" : "are"} waiting for approval and not shown.{" "}
            <Link href={`/campaigns/${campaign.id}`} className="text-accent">
              Review them →
            </Link>
          </span>
        )}
      </div>

      {p.approvedCount === 0 && (
        <Empty>
          Nothing approved yet for this campaign. <Link href={`/campaigns/${campaign.id}`} className="text-accent">Review and approve it</Link> to see the preview.
        </Empty>
      )}

      <div className="space-y-8">
        {p.idea && (
          <Block title="The big idea" tool={TOOL_NAMES.ideas}>
            <div className="rounded-lg border border-line bg-surface p-5">
              <p className="text-xl font-semibold wrap-break-word">{p.idea.title}</p>
              <p className="mt-2 text-lg wrap-break-word">“{p.idea.hook}”</p>
              <p className="mt-2 max-w-3xl text-sm text-muted">{p.idea.core_concept}</p>
            </div>
          </Block>
        )}

        {ads.length > 0 && (
          <Block title="Feed ads" tool={p.statics ? `${TOOL_NAMES.static} + ${TOOL_NAMES.copy}` : TOOL_NAMES.copy} note="Facebook & Instagram feed, 4:5">
            <div className="grid justify-items-center gap-6 sm:justify-items-start md:grid-cols-2 xl:grid-cols-3">
              {ads.map(({ key, ...a }) => (
                <FeedAdPreview key={key} {...a} />
              ))}
            </div>
            {!p.statics && <p className="mt-3 text-xs text-muted">No approved image ads yet, so the brand background is shown.</p>}
          </Block>
        )}

        {ads.length > 0 && p.statics && (
          <Block title="Stories & Reels ads" tool={TOOL_NAMES.static} note="Full screen, 9:16">
            <div className="flex flex-wrap justify-center gap-5 sm:justify-start">
              {ads.map(({ key, ...a }) => (
                <StoryAdPreview key={key} {...a} />
              ))}
            </div>
          </Block>
        )}

        {otherCopy.length > 0 && (
          <Block title="More approved copy" tool={TOOL_NAMES.copy} note="Ready for A/B tests">
            <ul className="grid gap-3 md:grid-cols-2">
              {otherCopy.map((c) => (
                <li key={c.id} className="min-w-0 rounded-lg border border-line bg-surface p-4 text-sm">
                  <p className="font-semibold wrap-break-word">{c.hook}</p>
                  <p className="mt-1 line-clamp-4 whitespace-pre-line text-muted">{c.primary_text}</p>
                  <p className="mt-2 font-medium wrap-break-word">
                    {c.headline} <span className="text-xs font-normal text-muted">· {c.cta}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {hasVideo && (
          <Block title="Video" tool={[p.script && TOOL_NAMES.script, p.ugc && TOOL_NAMES.ugc, p.edit && TOOL_NAMES.edit].filter(Boolean).join(" · ")}>
            <div className="space-y-4">
              {p.script && (
                <Panel title="Script and storyboard">
                  <ScriptView o={p.script} />
                </Panel>
              )}
              {p.ugc && (
                <Panel title="UGC production pack">
                  <UgcView o={p.ugc} />
                </Panel>
              )}
              {p.edit && (
                <Panel title="Edit plan">
                  <EditView o={p.edit} />
                </Panel>
              )}
            </div>
          </Block>
        )}

        {p.landing && (
          <Block title="Landing page" tool={TOOL_NAMES.landing}>
            <div className="rounded-lg border border-line bg-surface p-4">
              <LandingView o={p.landing} brand={brand} />
            </div>
          </Block>
        )}
      </div>
    </>
  );
}

function Block({ title, tool, note, children }: { title: string; tool: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-xs text-muted">
          {tool}
          {note ? ` · ${note}` : ""}
        </span>
      </div>
      {children}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="min-w-0 rounded-lg border border-line bg-surface p-4" open>
      <summary className="cursor-pointer font-medium">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
