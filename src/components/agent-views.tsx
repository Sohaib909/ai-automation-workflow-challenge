import type { EditOut, LandingOut, ScriptOut, StaticOut, UgcOut } from "@/lib/agents/specs";
import { LandingPreview } from "./landing-preview";
import { AdComposer } from "./ad-composer";
import { ActionForm, GeneratingPanel, Submit } from "./action-form";
import { generateConceptImageAction } from "@/app/actions";
import { ImageAutoFill } from "./image-autofill";

export function ScriptView({ o }: { o: ScriptOut }) {
  const total = o.scenes.reduce((a, s) => a + s.duration_sec, 0);
  const starts = o.scenes.map((_, i) => o.scenes.slice(0, i).reduce((a, s) => a + s.duration_sec, 0));
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold">{o.title}</p>
      <div>
        <p className="text-xs font-semibold text-muted uppercase">Hook options (first 2 seconds)</p>
        <ol className="list-decimal pl-5">
          {o.hooks.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 pr-2">Time</th>
              <th className="pr-2">What we see</th>
              <th className="pr-2">What is said</th>
              <th className="pr-2">On-screen text</th>
              <th>B-roll</th>
            </tr>
          </thead>
          <tbody>
            {o.scenes.map((s, i) => {
              const start = starts[i];
              const end = start + s.duration_sec;
              return (
                <tr key={i} className="border-t border-line align-top">
                  <td className="tabular py-1.5 pr-2 whitespace-nowrap">
                    {start}–{end}s
                  </td>
                  <td className="py-1.5 pr-2">{s.visual}</td>
                  <td className="py-1.5 pr-2">{s.voiceover || "—"}</td>
                  <td className="py-1.5 pr-2">{s.on_screen_text || "—"}</td>
                  <td className="py-1.5">{s.broll || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Total {total}s · CTA: <strong className="text-ink">{o.cta}</strong>
      </p>
      {o.production_notes && <p className="rounded bg-surface-2 p-2 text-xs text-muted">{o.production_notes}</p>}
    </div>
  );
}

export function StaticView({
  o,
  outputId,
  headline,
  subline,
  cta,
  brand,
  autoFill = false,
}: {
  o: StaticOut;
  outputId: number;
  headline?: string;
  subline?: string;
  cta?: string;
  brand: string;
  /** Automatically make the images the build couldn't (free tier: one per 45s). */
  autoFill?: boolean;
}) {
  // Missing = no image yet, or a new one was asked for (the old one stays on screen until it arrives).
  const missing = o.concepts.map((c, index) => ({ index, name: c.name, has: !!c.images?.square && !c.images?.pending })).filter((c) => !c.has);
  return (
    <div className="space-y-6">
      {autoFill && missing.length > 0 && <ImageAutoFill key={outputId} outputId={outputId} missing={missing.map(({ index, name }) => ({ index, name }))} />}
      {o.concepts.map((c, i) => (
        <div key={i} className="space-y-3">
          <div>
            <p className="font-semibold">
              Concept {i + 1}: {c.name}
            </p>
            <p className="text-sm text-muted">{c.visual_concept}</p>
          </div>
          <ActionForm action={generateConceptImageAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="output_id" value={outputId} />
            <input type="hidden" name="index" value={i} />
            {!c.images?.square && <span className="text-xs text-warn">No image yet for this concept.</span>}
            {c.images?.square && c.images.pending && <span className="text-xs text-info">New image on the way. Showing the current one until it&apos;s ready.</span>}
            <input
              name="instruction"
              maxLength={300}
              placeholder="What should change in this image? (optional)"
              aria-label={`What should change in the image for ${c.name}`}
              className="min-w-0 flex-1 basis-64"
            />
            <Submit pending="Generating image…" variant={c.images?.square ? "secondary" : "primary"}>
              {c.images?.square ? "↻ New image for this concept" : "✦ Generate image"}
            </Submit>
            <GeneratingPanel what="Generating the image" />
          </ActionForm>
          <p className="-mt-2 text-[11px] text-muted">Only this concept&apos;s image changes. The headline, button and brand are added by the ad template, not the image: use the switch beside the ad to hide the button.</p>
          <AdComposer
            key={`${c.images?.square ?? "none"}|${o.show_cta !== false}`}
            images={{ square: c.images?.square ?? null, tall: c.images?.tall ?? null }}
            headline={headline ?? c.name}
            subline={subline}
            cta={cta ?? "Learn More"}
            brand={brand}
            name={c.name}
            showCta={o.show_cta !== false}
            outputId={outputId}
          />
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Image prompt, composition and alt text</summary>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-muted uppercase">Composition</dt>
                <dd>{c.composition}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted uppercase">Alt text</dt>
                <dd>{c.alt_text}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-muted uppercase">Image prompt</dt>
                <dd className="rounded bg-surface-2 p-2 font-mono text-[11px]">{c.image_prompt}</dd>
              </div>
            </dl>
          </details>
        </div>
      ))}
    </div>
  );
}

export function UgcView({ o }: { o: UgcOut }) {
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["Presenter", o.presenter_brief],
            ["Setting", o.setting],
            ["Wardrobe", o.wardrobe],
            ["Delivery", o.delivery_notes],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-semibold text-muted uppercase">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 pr-2">Shot</th>
              <th className="pr-2">Framing</th>
              <th className="pr-2">Action</th>
              <th>Line</th>
            </tr>
          </thead>
          <tbody>
            {o.shot_list.map((s, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-1.5 pr-2 font-medium">{s.shot}</td>
                <td className="py-1.5 pr-2">{s.framing}</td>
                <td className="py-1.5 pr-2">{s.action}</td>
                <td className="py-1.5">{s.line || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o.b_roll.length > 0 && (
        <p className="text-xs">
          <strong>B-roll:</strong> {o.b_roll.join(" · ")}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <p className="rounded bg-surface-2 p-2 text-xs">
          <strong>Disclosure:</strong> {o.disclosure || "Not needed (real creator)"}
        </p>
        <p className="rounded bg-surface-2 p-2 text-xs">
          <strong>Consent:</strong> {o.consent_note}
        </p>
      </div>
      <div className="rounded-md border border-dashed border-line p-2 text-xs">
        <p className="mb-1 font-semibold">
          Render job spec <span className="font-normal text-muted">· status: not submitted (no video provider connected)</span>
        </p>
        <p className="text-muted">
          {o.job_spec.aspect_ratio} · {o.job_spec.duration_sec}s · {o.job_spec.scenes} scenes · voice: {o.job_spec.voice} · presenter: {o.job_spec.presenter_style}
        </p>
      </div>
    </div>
  );
}

export function EditView({ o }: { o: EditOut }) {
  const total = Math.max(o.total_duration_sec, ...o.timeline.map((x) => x.end_sec), 1);
  return (
    <div className="space-y-3 text-sm">
      <div aria-hidden className="flex h-6 w-full overflow-hidden rounded border border-line">
        {o.timeline.map((x, i) => (
          <div
            key={i}
            className={`h-full border-r border-surface text-[9px] leading-6 text-white ${i % 2 ? "bg-ai" : "bg-accent"}`}
            style={{ width: `${((x.end_sec - x.start_sec) / total) * 100}%` }}
            title={`${x.start_sec}–${x.end_sec}s ${x.action}`}
          >
            <span className="px-1">{i + 1}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 pr-2">#</th>
              <th className="pr-2">Time</th>
              <th className="pr-2">Clip</th>
              <th className="pr-2">Edit</th>
              <th className="pr-2">Caption</th>
              <th>B-roll</th>
            </tr>
          </thead>
          <tbody>
            {o.timeline.map((x, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-1.5 pr-2">{i + 1}</td>
                <td className="tabular py-1.5 pr-2 whitespace-nowrap">
                  {x.start_sec}–{x.end_sec}s
                </td>
                <td className="py-1.5 pr-2">{x.source}</td>
                <td className="py-1.5 pr-2">{x.action}</td>
                <td className="py-1.5 pr-2">{x.caption || "—"}</td>
                <td className="py-1.5">{x.broll || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <p className="rounded bg-surface-2 p-2">
          <strong>Music:</strong> {o.music.mood} · {o.music.ducking}
        </p>
        <p className="rounded bg-surface-2 p-2">
          <strong>Branding:</strong> {o.branding.logo_placement} · End card: {o.branding.end_card}
        </p>
        <p className="rounded bg-surface-2 p-2">
          <strong>Exports:</strong> {o.exports.map((e) => `${e.ratio} ${e.duration_sec}s${e.notes ? ` (${e.notes})` : ""}`).join(" · ")}
        </p>
      </div>
    </div>
  );
}

export function LandingView({ o, brand }: { o: LandingOut; brand: string }) {
  return <LandingPreview o={o} brand={brand} />;
}
