/**
 * Per-campaign AI settings: how many of each thing to generate, the choices for each agent, and which
 * agents the autopilot should run. Client-safe (used by forms and by the server).
 */

import { TOOL_NAMES } from "./tool-names";

export interface RunSettings {
  ideas: number;
  copy: number;
  static_concepts: number;
  script_format: string;
  script_duration: string;
  script_presenter: string;
  ugc_route: string;
  edit_style: string;
  landing_length: string;
  run_static: boolean;
  run_script: boolean;
  run_ugc: boolean;
  run_edit: boolean;
  run_landing: boolean;
}

export const SETTING_FIELDS = {
  ideas: { label: "Ideas to generate", choices: ["3", "4", "5", "6"] },
  copy: { label: "Ad copy versions", choices: ["2", "3", "4", "5"] },
  static_concepts: { label: "Image ad concepts", choices: ["1", "2", "3"] },
  script_format: { label: "Video format", choices: ["UGC-style (creator to camera)", "Explainer", "Promo / brand"] },
  script_duration: { label: "Video length", choices: ["15", "30", "45", "60"], suffix: " seconds" },
  script_presenter: { label: "Presenter", choices: ["Real creator", "Staff member", "AI presenter", "Voiceover only"] },
  ugc_route: { label: "UGC production", choices: ["Real creator", "AI presenter (avatar)"] },
  edit_style: { label: "Editing style", choices: ["Native / UGC (fast cuts, bold captions)", "Polished brand", "Documentary"] },
  landing_length: { label: "Landing page", choices: ["Short (5 sections)", "Standard (7 sections)"] },
} as const;

export const AGENT_TOGGLES = [
  { key: "run_static", label: TOOL_NAMES.static },
  { key: "run_script", label: TOOL_NAMES.script },
  { key: "run_ugc", label: TOOL_NAMES.ugc },
  { key: "run_edit", label: TOOL_NAMES.edit },
  { key: "run_landing", label: TOOL_NAMES.landing },
] as const;

export const DEFAULT_SETTINGS: RunSettings = {
  ideas: 4,
  copy: 3,
  static_concepts: 2,
  script_format: "UGC-style (creator to camera)",
  script_duration: "30",
  script_presenter: "Real creator",
  ugc_route: "Real creator",
  edit_style: "Native / UGC (fast cuts, bold captions)",
  landing_length: "Short (5 sections)",
  run_static: true,
  run_script: true,
  run_ugc: true,
  run_edit: true,
  run_landing: true,
};

/** Read settings from a submitted form (invalid values fall back to defaults). */
export function settingsFromForm(fd: FormData | Record<string, unknown>): RunSettings {
  const get = (k: string) => (fd instanceof FormData ? fd.get(`s_${k}`) : (fd as Record<string, unknown>)[`s_${k}`]);
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const [k, def] of Object.entries(SETTING_FIELDS)) {
    const v = String(get(k) ?? "");
    if ((def.choices as readonly string[]).includes(v)) out[k] = typeof DEFAULT_SETTINGS[k as keyof RunSettings] === "number" ? Number(v) : v;
  }
  // Checkbox toggles only exist when the settings section was submitted; otherwise keep defaults.
  if (get("present") === "1") for (const t of AGENT_TOGGLES) out[t.key] = get(t.key) === "on";
  if (!out.run_script) {
    out.run_ugc = false;
    out.run_edit = false;
  }
  return out as unknown as RunSettings;
}

export function parseSettings(json: string | null | undefined): RunSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(json || "{}") as Partial<RunSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
