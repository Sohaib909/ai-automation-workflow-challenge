/**
 * The nine AI agents from the brief. One registry drives the sidebar, the agents hub, each agent's
 * flow diagram and its honest build status.
 */

import { TOOL_NAMES } from "../tool-names";

export type StepKind = "in" | "ai" | "check" | "person" | "out";
export interface FlowStep {
  kind: StepKind;
  text: string;
}

export interface AgentMeta {
  slug: string;
  name: string;
  short: string;
  /** live = fully working in this MVP; live_partial = AI planning works, a paid media step is not connected */
  status: "live" | "live_partial";
  /** What is not connected in this prototype, stated plainly. */
  notConnected?: string;
  /** Where the working tool lives (for agents built into other pages). */
  href?: string;
  flow: FlowStep[];
  humanGate: string;
}

export const AGENTS: AgentMeta[] = [
  {
    slug: "ideas",
    name: TOOL_NAMES.ideas,
    short: "Turns a brief into distinct, scored campaign ideas",
    status: "live",
    flow: [
      { kind: "in", text: "Brief, brand rules, past ideas, performance learnings" },
      { kind: "ai", text: "Suggests 3–6 ideas, each from a different creative lens" },
      { kind: "ai", text: "Scores 8 criteria and explains each score" },
      { kind: "check", text: "No made-up facts, no banned phrases, no repeats" },
      { kind: "person", text: "Strategist approves, rejects or rates" },
      { kind: "out", text: "Approved idea feeds every other agent" },
    ],
    humanGate: "Strategist approves or rejects every idea; ratings steer the next batch.",
  },
  {
    slug: "copy",
    name: TOOL_NAMES.copy,
    short: "Hooks, headlines, primary text and CTAs from an approved idea",
    status: "live",
    flow: [
      { kind: "in", text: "Approved idea, offer, brand voice" },
      { kind: "ai", text: "Writes several ad variations" },
      { kind: "check", text: "Meta length limits, unproven claims, banned phrases, valid CTA" },
      { kind: "person", text: "Edit or regenerate one field (new version)" },
      { kind: "person", text: "Approve — QC errors block approval" },
      { kind: "out", text: "Ready copy, CSV export" },
    ],
    humanGate: "Copywriter approves; any edit resets approval.",
  },
  {
    slug: "static",
    name: TOOL_NAMES.static,
    short: "Finished image ads in Meta sizes (1:1, 4:5, 9:16), ready to download",
    status: "live",
    flow: [
      { kind: "in", text: "Approved idea + approved copy + brand" },
      { kind: "ai", text: "Visual concept and image prompt" },
      { kind: "ai", text: "Generates the image (FLUX)" },
      { kind: "check", text: "Template adds the real headline, button and brand, never drawn by AI" },
      { kind: "check", text: "Meta sizes, Stories safe zones, text length" },
      { kind: "person", text: "Designer approves" },
      { kind: "out", text: "PNG ads: 1:1, 4:5, 9:16" },
    ],
    humanGate: "Designer reviews every ad before it is used.",
  },
  {
    slug: "script",
    name: TOOL_NAMES.script,
    short: "Scene-by-scene ad and UGC scripts timed to the target length",
    status: "live",
    flow: [
      { kind: "in", text: "Approved idea, format, duration, presenter" },
      { kind: "ai", text: "3 alternative hooks + scene-by-scene script" },
      { kind: "check", text: "Fits the duration (≈2.5 words/sec), CTA present, claim check" },
      { kind: "person", text: "Creative lead approves before production" },
      { kind: "out", text: "Script ready for AI UGC Video and AI Video Editing" },
    ],
    humanGate: "Creative lead approves before any production spend.",
  },
  {
    slug: "ugc",
    name: TOOL_NAMES.ugc,
    short: "Production pack for a creator or AI presenter from an approved script",
    status: "live_partial",
    notConnected: "No avatar/video provider (e.g. HeyGen, Veo, Wan/LTX via ComfyUI) is connected, so no video is rendered. The AI prepares the full production pack and the provider job spec; the job is marked 'not submitted'.",
    flow: [
      { kind: "in", text: "Approved script" },
      { kind: "person", text: "Choose route: real creator or AI presenter" },
      { kind: "ai", text: "Presenter brief, shot list, wardrobe/setting, job spec" },
      { kind: "check", text: "Consent, AI disclosure and claim checks" },
      { kind: "person", text: "Producer approves the pack" },
      { kind: "out", text: "Creator brief or render job → AI Video Editing" },
    ],
    humanGate: "Producer approves the pack; every rendered take is reviewed for realism, consent and disclosure.",
  },
  {
    slug: "edit",
    name: TOOL_NAMES.edit,
    short: "Edit plan: cuts, captions, B-roll, music and export versions",
    status: "live_partial",
    notConnected: "Rendering (FFmpeg/Whisper worker or Creatomate/Shotstack) is not connected. The AI produces the edit decision list from the approved script; an editor or render service would execute it.",
    flow: [
      { kind: "in", text: "Approved script (+ footage when connected)" },
      { kind: "ai", text: "Edit plan: timeline, cuts, captions, B-roll cues" },
      { kind: "ai", text: "Music, branding and export versions (9:16, 4:5, 1:1)" },
      { kind: "check", text: "Timeline fits duration, captions on every spoken line" },
      { kind: "person", text: "Editor approves and fine-tunes" },
      { kind: "out", text: "Edit plan for render; originals kept" },
    ],
    humanGate: "Editor approves pacing and the final cut.",
  },
  {
    slug: "landing",
    name: TOOL_NAMES.landing,
    short: "Section plan and copy rendered as a desktop/mobile page preview",
    status: "live",
    flow: [
      { kind: "in", text: "Approved idea + copy, offer, CTA" },
      { kind: "ai", text: "Plans sections: hero, problem, offer, FAQ" },
      { kind: "ai", text: "Writes each section to match the ad" },
      { kind: "check", text: "No invented testimonials, figures from the brief only" },
      { kind: "person", text: "Preview, approve — publishing stays manual" },
      { kind: "out", text: "Versioned page ready to publish" },
    ],
    humanGate: "Approval required before publishing; nothing is deployed automatically.",
  },
  {
    slug: "toast",
    name: TOOL_NAMES.toast,
    short: "All clients' Meta results in one validated dashboard",
    status: "live",
    href: "/toast",
    flow: [
      { kind: "in", text: "Meta Ads export (API read-only later)" },
      { kind: "check", text: "Validate, dedupe, map account → client; gaps stay 'unavailable'" },
      { kind: "check", text: "Spend, results, CTR, cost per result, ROAS from totals" },
      { kind: "ai", text: "Plain-English summary, every figure checked" },
      { kind: "person", text: "Account manager reviews" },
      { kind: "out", text: "Dashboard and client summary" },
    ],
    humanGate: "Account manager reviews summaries before they reach a client.",
  },
  {
    slug: "media-buyer",
    name: TOOL_NAMES["media-buyer"],
    short: "Read-only monitoring with evidence-backed recommendations",
    status: "live",
    href: "/media-buyer",
    flow: [
      { kind: "in", text: "Daily results from Toast / Meta Ads Analysis" },
      { kind: "check", text: "Rules: rising costs, fatigue, spend spikes, no results, winners" },
      { kind: "ai", text: "Explains with the numbers and suggests a next step" },
      { kind: "person", text: "Media buyer accepts, rejects or dismisses" },
      { kind: "person", text: "Person makes any change in Ads Manager" },
      { kind: "out", text: "Learnings sent back to the AI Idea Generator" },
    ],
    humanGate: "Read-only. A person makes every change in Ads Manager.",
  },
];

export const agentBySlug = (slug: string) => AGENTS.find((a) => a.slug === slug);
export const PRODUCTION_AGENTS = ["script", "static", "ugc", "edit", "landing"] as const;
export type ProductionAgent = (typeof PRODUCTION_AGENTS)[number];
