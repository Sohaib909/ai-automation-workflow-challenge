"use client";

import { useMemo, useState } from "react";

export interface Point {
  date: string;
  spend: number | null;
  results: number | null;
  cpr: number | null;
  ctr: number | null;
  roas: number | null;
}

const METRICS = {
  spend: { label: "Spend", f: (v: number) => `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` },
  results: { label: "Results", f: (v: number) => Math.round(v).toLocaleString("en-GB") },
  cpr: { label: "Cost per result", f: (v: number) => `£${v.toFixed(2)}` },
  ctr: { label: "CTR", f: (v: number) => `${(v * 100).toFixed(2)}%` },
  roas: { label: "ROAS", f: (v: number) => `${v.toFixed(2)}x` },
} as const;
type Metric = keyof typeof METRICS;

/** Single-series daily trend: 2px line, crosshair + tooltip, gaps for unavailable days, table view. */
export function TrendChart({ data }: { data: Point[] }) {
  const [metric, setMetric] = useState<Metric>("spend");
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const P = { l: 56, r: 12, t: 12, b: 28 };

  const { path, ticks, x, y, max } = useMemo(() => {
    const vals = data.map((d) => d[metric]);
    const finite = vals.filter((v): v is number => v != null);
    const rawMax = finite.length ? Math.max(...finite) : 1;
    const step = niceStep(rawMax / 4);
    const max = Math.max(step * 4, step);
    const x = (i: number) => P.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - P.l - P.r));
    const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
    let path = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return { path, ticks: [0, 1, 2, 3, 4].map((k) => k * step), x, y, max };
  }, [data, metric, P.b, P.l, P.r, P.t]);

  const fmt = METRICS[metric].f;
  const unavailable = data.every((d) => d[metric] == null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Metric">
        {(Object.keys(METRICS) as Metric[]).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={metric === m}
            onClick={() => setMetric(m)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${metric === m ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2"}`}
          >
            {METRICS[m].label}
          </button>
        ))}
      </div>
      {unavailable ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          {METRICS[metric].label} is unavailable for this selection. The source data doesn&apos;t include the inputs needed.
        </p>
      ) : (
        <div className="relative w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[480px]"
            role="img"
            aria-label={`${METRICS[metric].label} per day`}
            onPointerLeave={() => setHover(null)}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              const i = Math.round(((px - P.l) / (W - P.l - P.r)) * (data.length - 1));
              setHover(Math.max(0, Math.min(data.length - 1, i)));
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % Math.ceil(data.length / 7) === 0 ? (
                <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {d.date.slice(5)}
                </text>
              ) : null,
            )}
            <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
                {data[hover][metric] != null && <circle cx={x(hover)} cy={y(data[hover][metric]!)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />}
              </g>
            )}
            <rect x={P.l} y={P.t} width={W - P.l - P.r} height={H - P.t - P.b} fill="transparent" />
          </svg>
          {hover != null && (
            <div
              className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
              style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 60px), calc(100% - 130px))` }}
            >
              <div className="tabular font-semibold">{data[hover][metric] == null ? "Unavailable" : fmt(data[hover][metric]!)}</div>
              <div className="text-muted">
                {METRICS[metric].label} · {data[hover].date}
              </div>
            </div>
          )}
          <span className="sr-only">Maximum on scale {fmt(max)}</span>
        </div>
      )}
      <details className="mt-2 text-xs">
        <summary className="text-accent">Table view</summary>
        <div className="mt-2 max-h-60 overflow-auto">
          <table className="tabular w-full">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1">Date</th>
                {(Object.keys(METRICS) as Metric[]).map((m) => (
                  <th key={m} className="py-1 text-right">
                    {METRICS[m].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-1">{d.date}</td>
                  {(Object.keys(METRICS) as Metric[]).map((m) => (
                    <td key={m} className="py-1 text-right">
                      {d[m] == null ? "—" : METRICS[m].f(d[m]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
