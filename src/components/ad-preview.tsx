import { AdCanvas } from "./ad-composer";

/**
 * How an approved ad will look in Meta placements. The creative itself is the same canvas the ad composer
 * downloads; the surrounding frame (page name, "Sponsored", link bar) is a mock-up of the placement.
 */

interface AdBits {
  brand: string;
  image: string | null;
  name: string;
  hook: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  showCta?: boolean;
}

function Avatar({ brand }: { brand: string }) {
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-white">
      {brand.trim().charAt(0).toUpperCase() || "•"}
    </span>
  );
}

export function FeedAdPreview(a: AdBits) {
  return (
    <article className="w-full max-w-[420px] min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-sm" aria-label={`Feed ad: ${a.headline}`}>
      <header className="flex items-center gap-2.5 px-3 pt-3">
        <Avatar brand={a.brand} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">{a.brand}</p>
          <p className="text-xs text-muted">Sponsored · 🌐</p>
        </div>
        <span aria-hidden className="ml-auto text-muted">
          ···
        </span>
      </header>
      <div className="px-3 py-2.5 text-sm wrap-break-word whitespace-pre-line">
        {a.hook && <strong className="font-semibold">{a.hook}</strong>}
        {a.hook && a.primaryText ? "\n" : ""}
        {a.primaryText}
      </div>
      <AdCanvas format="4:5" images={{ square: a.image, tall: null }} headline={a.headline} subline={a.description} cta={a.cta} brand={a.brand} name={a.name} showCta={a.showCta} />
      <div className="flex items-center gap-3 bg-surface-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-muted uppercase">{a.brand.toLowerCase().replace(/[^a-z0-9]+/g, "")}.org</p>
          <p className="truncate text-sm font-semibold" title={a.headline}>
            {a.headline}
          </p>
          {a.description && (
            <p className="truncate text-xs text-muted" title={a.description}>
              {a.description}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-line px-3 py-1.5 text-xs font-semibold text-ink">{a.cta}</span>
      </div>
      <footer aria-hidden className="flex justify-around border-t border-line px-3 py-2 text-xs text-muted">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </footer>
    </article>
  );
}

export function StoryAdPreview(a: AdBits) {
  return (
    <article className="relative w-full max-w-[240px] min-w-0 overflow-hidden rounded-[22px] border-4 border-ink/80 bg-black shadow-md" aria-label={`Stories ad: ${a.headline}`}>
      <AdCanvas format="9:16" images={{ square: a.image, tall: null }} headline={a.headline} subline={a.description} cta={a.cta} brand={a.brand} name={a.name} showCta={a.showCta} />
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-2.5 pt-2 pb-6">
        <div aria-hidden className="mb-2 h-0.5 rounded-full bg-white/40">
          <div className="h-full w-1/3 rounded-full bg-white" />
        </div>
        <div className="flex items-center gap-2 text-white">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold">{a.brand.trim().charAt(0).toUpperCase()}</span>
          <span className="min-w-0 truncate text-[11px] font-semibold">{a.brand}</span>
          <span className="shrink-0 text-[10px] opacity-80">Sponsored</span>
        </div>
      </div>
    </article>
  );
}
