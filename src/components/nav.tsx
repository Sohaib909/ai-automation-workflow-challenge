"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOOL_NAMES } from "@/lib/tool-names";

type Item = { href: string; label: string; soon?: boolean };

const MAIN: Item[] = [
  { href: "/", label: "Home" },
  { href: "/clients", label: "Campaigns" },
  { href: "/approvals", label: "Approvals" },
  { href: "/preview", label: "Preview" },
  { href: "/toast", label: TOOL_NAMES.toast, soon: true },
];
const AGENTS = [
  { href: "/agents/ideas", label: TOOL_NAMES.ideas },
  { href: "/agents/copy", label: TOOL_NAMES.copy },
  { href: "/agents/static", label: TOOL_NAMES.static },
  { href: "/agents/script", label: TOOL_NAMES.script },
  { href: "/agents/ugc", label: TOOL_NAMES.ugc },
  { href: "/agents/edit", label: TOOL_NAMES.edit },
  { href: "/agents/landing", label: TOOL_NAMES.landing },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) || (href === "/clients" && path.startsWith("/campaigns")));
  const link = (i: Item, small = false) => (
    <Link
      href={i.href}
      aria-current={active(i.href) ? "page" : undefined}
      className={`flex items-center justify-between gap-2 rounded-md px-2 ${small ? "py-1 text-[13px]" : "py-1.5 text-sm"} ${active(i.href) ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-2"}`}
    >
      <span className="min-w-0">{i.label}</span>
      {i.soon && <span className="shrink-0 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-warn">Coming soon</span>}
    </Link>
  );
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1 md:flex-col md:gap-0.5">
      {MAIN.map((i) => (
        <div key={i.href}>{link(i)}</div>
      ))}
      <details className="md:mt-2" open={path.startsWith("/agents")}>
        <summary className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2">AI agents (use one by one)</summary>
        <div className="mt-0.5 pl-2">
          {link({ href: "/agents", label: "All 9 agents" }, true)}
          {AGENTS.map((i) => (
            <div key={i.href}>{link(i, true)}</div>
          ))}
        </div>
      </details>
      <div className="md:mt-2">{link({ href: "/activity", label: "Activity log" })}</div>
    </nav>
  );
}
