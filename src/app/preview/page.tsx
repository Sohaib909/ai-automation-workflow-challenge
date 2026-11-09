import Link from "next/link";
import { connection } from "next/server";
import { syncStore } from "@/lib/db";
import { previewableCampaigns } from "@/lib/preview";
import { Badge, Empty, PageHeader } from "@/components/ui";

export default async function PreviewIndexPage() {
  await connection();
  await syncStore();
  const campaigns = previewableCampaigns();

  return (
    <>
      <PageHeader title="Preview" subtitle="See how each approved campaign will look live: feed and Stories ads, video plan and landing page. Only approved work is shown." />
      {campaigns.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((k) => (
            <li key={k.id} className="min-w-0">
              <Link href={`/preview/${k.id}`} className="group flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface hover:border-accent">
                <div className="relative aspect-[16/9] bg-gradient-to-br from-[#3d2a52] to-accent">
                  {k.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={k.cover} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  )}
                  {k.headline && (
                    <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 text-sm font-semibold text-white">{k.headline}</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                  <span className="line-clamp-2 font-semibold wrap-break-word group-hover:text-accent" title={k.name}>
                    {k.name}
                  </span>
                  <span className="truncate text-sm text-muted">
                    {k.client} · {k.objective}
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-2">
                    <Badge tone="good">✓ {k.approved} approved</Badge>
                    {k.waiting > 0 && <Badge tone="accent">{k.waiting} waiting for your OK</Badge>}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          Nothing approved yet. Open a campaign from <Link href="/clients" className="text-accent">Campaigns</Link>, review what the AI built and approve it. It will appear here.
        </Empty>
      )}
    </>
  );
}
