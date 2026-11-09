"use client";

import { useEffect, useRef, useState } from "react";
import { setShowCtaAction } from "@/app/actions";

/**
 * Finished static ad, drawn at real Meta size on a canvas: AI image + headline + description + brand + button.
 * Text is set by this template (never drawn by the image model), respecting Stories safe zones.
 * What you see is exactly what downloads.
 */

const FORMATS = [
  { key: "1:1", label: "Feed 1:1", w: 1080, h: 1080, img: "square" as const },
  { key: "4:5", label: "Feed 4:5", w: 1080, h: 1350, img: "square" as const },
  { key: "9:16", label: "Stories / Reels 9:16", w: 1080, h: 1920, img: "tall" as const },
];

export interface AdProps {
  images: { square: string | null; tall: string | null };
  headline: string;
  subline?: string;
  cta: string;
  brand: string;
  name: string;
  /** Draw the call-to-action button on the image (default). Meta also shows the button under the ad. */
  showCta?: boolean;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, "")}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function draw(canvas: HTMLCanvasElement, f: (typeof FORMATS)[number], p: AdProps): Promise<boolean> {
  const ctx = canvas.getContext("2d")!;
  canvas.width = f.w;
  canvas.height = f.h;
  const src = p.images[f.img] ?? p.images.square ?? p.images.tall;
  let hasImage = false;
  if (src) {
    const img = new Image();
    if (/^https?:/.test(src)) img.crossOrigin = "anonymous"; // linked images: allow PNG export
    img.src = src;
    hasImage = await img.decode().then(
      () => true,
      () => false,
    );
    if (hasImage) {
      const cover = () => {
        const scale = Math.max(f.w / img.naturalWidth, f.h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (f.w - dw) / 2, (f.h - dh) / 2, dw, dh);
      };
      const isSquareSource = img.naturalHeight / img.naturalWidth < 1.3;
      if (f.key === "9:16" && isSquareSource) {
        // Tall format from a square image: blurred extension behind, the full image sharp in the middle.
        ctx.filter = "blur(48px) brightness(0.75)";
        cover();
        ctx.filter = "none";
        const size = f.w;
        ctx.drawImage(img, 0, (f.h - size) / 2, size, size * (img.naturalHeight / img.naturalWidth));
      } else cover();
    }
  }
  if (!hasImage) {
    const g = ctx.createLinearGradient(0, 0, f.w, f.h);
    g.addColorStop(0, "#3d2a52");
    g.addColorStop(0.55, "#c8306e");
    g.addColorStop(1, "#f2a65a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.w, f.h);
  }

  const story = f.key === "9:16";
  const pad = 80;
  const top = story ? f.h * 0.14 : 90; // Stories: keep clear of the top 14% (profile/progress bar)
  const bottomSafe = story ? f.h * 0.2 : 0; // and the bottom 20% (reply bar)

  // Scrims keep text readable on any photo
  let g = ctx.createLinearGradient(0, 0, 0, f.h * 0.55);
  g.addColorStop(0, "rgba(0,0,0,0.62)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.w, f.h * 0.55);
  g = ctx.createLinearGradient(0, f.h * 0.62, 0, f.h);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(0, f.h * 0.62, f.w, f.h * 0.38);

  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 12;
  const hSize = story ? 96 : f.key === "4:5" ? 88 : 82;
  ctx.font = `800 ${hSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const lines = wrap(ctx, p.headline, f.w - pad * 2, 3);
  lines.forEach((l, i) => ctx.fillText(l, pad, top + i * hSize * 1.12));
  let y = top + lines.length * hSize * 1.12 + 18;
  if (p.subline) {
    ctx.font = `500 ${Math.round(hSize * 0.46)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    wrap(ctx, p.subline, f.w - pad * 2, 2).forEach((l) => {
      ctx.fillText(l, pad, y);
      y += hSize * 0.6;
    });
  }

  // Bottom bar: brand + button
  ctx.shadowBlur = 0;
  const btnH = 104;
  const by = f.h - bottomSafe - pad - btnH;
  ctx.font = `700 46px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const label = p.cta;
  const showCta = p.showCta !== false;
  const bw = showCta ? ctx.measureText(label).width + 96 : 0;
  ctx.textBaseline = "middle";
  if (showCta) {
    roundRect(ctx, f.w - pad - bw, by, bw, btnH, btnH / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = "#1d1a1e";
    ctx.fillText(label, f.w - pad - bw + 48, by + btnH / 2 + 2);
  }
  ctx.fillStyle = "#fff";
  ctx.shadowBlur = 10;
  // Brand name: shrink to fit next to the button; if still too long, use two lines.
  const room = showCta ? f.w - pad * 2.5 - bw : f.w - pad * 2;
  let size = 44;
  const font = (n: number) => `700 ${n}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font(size);
  while (ctx.measureText(p.brand).width > room && size > 30) ctx.font = font(--size);
  const brandLines = wrap(ctx, p.brand, room, 2);
  brandLines.forEach((l, i) => ctx.fillText(l, pad, by + btnH / 2 + 2 + (i - (brandLines.length - 1) / 2) * size * 1.15));
  return hasImage;
}

/** Just the finished ad at one size, with no controls: used by the campaign Preview page. */
export function AdCanvas({ format, className = "", ...p }: AdProps & { format: (typeof FORMATS)[number]["key"]; className?: string }) {
  const f = FORMATS.find((x) => x.key === format)!;
  const ref = useRef<HTMLCanvasElement>(null);
  const { headline, subline, cta, brand, name, showCta } = p;
  const square = p.images.square;
  const tall = p.images.tall;
  useEffect(() => {
    if (ref.current) draw(ref.current, f, { images: { square, tall }, headline, subline, cta, brand, name, showCta });
  }, [f, square, tall, headline, subline, cta, brand, name, showCta]);
  return <canvas ref={ref} role="img" aria-label={`${f.label} ad: ${headline}`} className={`block h-auto w-full ${className}`} style={{ aspectRatio: `${f.w} / ${f.h}` }} />;
}

export function AdComposer({ outputId, ...p }: AdProps & { outputId?: number }) {
  const [fmt, setFmt] = useState(FORMATS[0]);
  const [state, setState] = useState<"loading" | "ok" | "noimage">("loading");
  const [showCta, setShowCta] = useState(p.showCta !== false);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    if (ref.current)
      draw(ref.current, fmt, { ...p, showCta }).then((ok) => {
        if (live) setState(ok ? "ok" : "noimage");
      });
    return () => {
      live = false;
    };
  }, [fmt, p, showCta]);

  async function download(f = fmt) {
    const c = document.createElement("canvas");
    await draw(c, f, { ...p, showCta });
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${p.brand}-${p.name}-${f.key.replace(":", "x")}.png`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
    a.click();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="flex justify-center rounded-lg bg-surface-2 p-3">
        <canvas
          ref={ref}
          role="img"
          aria-label={`${fmt.label} ad: ${p.headline}`}
          className="h-auto rounded-md shadow-md"
          style={{ width: "100%", maxWidth: fmt.key === "9:16" ? 340 : fmt.key === "4:5" ? 440 : 520, aspectRatio: `${fmt.w} / ${fmt.h}` }}
        />
      </div>
      <div className="space-y-3 text-sm">
        <div role="radiogroup" aria-label="Ad size" className="flex flex-col gap-1">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              role="radio"
              aria-checked={fmt.key === f.key}
              onClick={() => {
                setState("loading");
                setFmt(f);
              }}
              className={`rounded-md border px-3 py-2 text-left ${fmt.key === f.key ? "border-accent bg-accent-soft font-medium text-accent" : "border-line hover:bg-surface-2"}`}
            >
              {f.label}
              <span className="block text-[11px] text-muted">
                {f.w}×{f.h}px
              </span>
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink hover:bg-surface-2">
          <input
            type="checkbox"
            checked={showCta}
            onChange={(e) => {
              setShowCta(e.target.checked);
              if (outputId) void setShowCtaAction(outputId, e.target.checked); // saved for every size, the Preview and downloads
            }}
          />
          <span className="min-w-0">
            Show “{p.cta}” button on image
          </span>
        </label>
        <button type="button" onClick={() => download()} className="w-full rounded-md bg-accent px-3 py-2 font-medium text-white hover:opacity-90">
          ↓ Download PNG
        </button>
        <button type="button" onClick={async () => { for (const f of FORMATS) await download(f); }} className="w-full rounded-md border border-line px-3 py-2 hover:bg-surface-2">
          ↓ All 3 sizes
        </button>
        {state === "loading" && <p className="text-xs text-muted">Loading image…</p>}
        {state === "noimage" && <p className="text-xs text-warn">No AI image available for this concept, so the brand background is shown. Click Regenerate to try again.</p>}
        <p className="text-[11px] text-muted">Headline, button and brand are set by the template, so the text is always sharp and correct. Stories keep clear of the top 14% and bottom 20%.</p>
      </div>
    </div>
  );
}
