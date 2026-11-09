"use client";

import { useState } from "react";
import type { LandingOut } from "@/lib/agents/specs";

/** Renders the generated page in a framed preview with a desktop/mobile toggle. */
export function LandingPreview({ o, brand }: { o: LandingOut; brand: string }) {
  const [mobile, setMobile] = useState(false);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          <strong className="text-ink">{o.page_title}</strong> · {o.meta_description}
        </p>
        <div className="flex shrink-0 rounded-md border border-line p-0.5 text-xs" role="radiogroup" aria-label="Preview size">
          {[
            ["Desktop", false],
            ["Mobile", true],
          ].map(([label, m]) => (
            <button
              key={String(label)}
              role="radio"
              aria-checked={mobile === m}
              onClick={() => setMobile(m as boolean)}
              className={`rounded px-2 py-0.5 ${mobile === m ? "bg-accent-soft font-medium text-accent" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3">
        <div className="mx-auto overflow-hidden rounded-md bg-white text-[#1d1a1e] shadow-sm transition-all" style={{ width: mobile ? 360 : "100%", maxWidth: "100%" }}>
          <div className="flex items-center justify-between border-b border-[#eee] px-4 py-2 text-xs">
            <strong>{brand}</strong>
            <span className="rounded bg-[#c8306e] px-2 py-0.5 font-semibold text-white">{o.sections.find((s) => s.cta_label)?.cta_label}</span>
          </div>
          {o.sections.map((s, i) => {
            const hero = s.type.toLowerCase() === "hero";
            return (
              <section key={i} className={`px-5 ${hero ? "bg-[#fbe8f0] py-8" : "py-5"} ${i % 2 && !hero ? "bg-[#faf8f9]" : ""}`}>
                <p className="mb-1 text-[10px] font-semibold tracking-wide text-[#c8306e] uppercase">{s.type.replace("_", " ")}</p>
                <h3 className={`${hero ? (mobile ? "text-xl" : "text-2xl") : "text-base"} mb-2 font-bold text-balance`}>{s.heading}</h3>
                {s.body && <p className="mb-2 text-sm leading-relaxed text-[#4a4448]">{s.body}</p>}
                {s.bullets.length > 0 && (
                  <ul className="mb-2 list-disc pl-5 text-sm text-[#4a4448]">
                    {s.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {s.cta_label && <span className="inline-block rounded-md bg-[#c8306e] px-4 py-2 text-sm font-semibold text-white">{s.cta_label}</span>}
              </section>
            );
          })}
          {o.faq.length > 0 && (
            <section className="px-5 py-5">
              <p className="mb-1 text-[10px] font-semibold tracking-wide text-[#c8306e] uppercase">FAQ</p>
              {o.faq.map((f) => (
                <details key={f.q} className="border-t border-[#eee] py-2 text-sm">
                  <summary className="font-medium">{f.q}</summary>
                  <p className="mt-1 text-[#4a4448]">{f.a}</p>
                </details>
              ))}
            </section>
          )}
          <footer className="border-t border-[#eee] px-4 py-3 text-[10px] text-[#888]">Preview only — not published. Publishing requires approval.</footer>
        </div>
      </div>
    </div>
  );
}
