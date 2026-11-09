import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { connection } from "next/server";
import "./globals.css";
import { Nav } from "@/components/nav";
import { providerStatus } from "@/lib/ai/generate";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CerealBox AI Studio",
  description:
    "Prototype: connected AI creative & ads-analysis workflows with human approval.",
};

async function ProviderStatus() {
  await connection(); // read env at request time, not build time
  const p = providerStatus();
  return (
    <div className="rounded-md border border-line bg-surface-2 p-2 text-xs">
      <div className="text-muted">AI provider</div>
      {p.error ? (
        <div className="font-medium text-bad">{p.error}</div>
      ) : p.isMock ? (
        <div
          className="font-medium text-warn"
          title="No API key configured — outputs are templates, clearly labelled"
        >
          Mock (no key set)
        </div>
      ) : (
        <div className="font-medium break-all">
          {p.id} · {p.model}
        </div>
      )}
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <div className="flex min-h-screen flex-col md:flex-row">
          <aside className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface p-4 md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
            <div>
              <div className="text-lg font-semibold tracking-tight">
                Cereal<span className="text-accent">Box</span> AI Studio
              </div>
              <div className="text-xs text-muted">Demo by Sohaib Ahmed</div>
            </div>
            <Suspense fallback={<div className="h-40" />}>
              <Nav />
            </Suspense>
            <div className="mt-auto space-y-2">
              <Suspense
                fallback={<div className="h-12 rounded-md bg-surface-2" />}
              >
                <ProviderStatus />
              </Suspense>
              <p className="text-[11px] leading-snug text-muted">
                No live ad accounts are connected.
              </p>
            </div>
          </aside>
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
