import { AGENT_TOGGLES, DEFAULT_SETTINGS, type RunSettings, SETTING_FIELDS } from "@/lib/run-settings";
import { TOOL_NAMES } from "@/lib/tool-names";

/** The "AI settings" block: counts, choices per agent, and which agents to run. Used in forms. */
export function RunSettingsFields({ value = DEFAULT_SETTINGS, open = false }: { value?: RunSettings; open?: boolean }) {
  const groups: { title: string; keys: (keyof typeof SETTING_FIELDS)[] }[] = [
    { title: "How many", keys: ["ideas", "copy", "static_concepts"] },
    { title: "Video", keys: ["script_format", "script_duration", "script_presenter", "ugc_route", "edit_style"] },
    { title: "Landing page", keys: ["landing_length"] },
  ];
  return (
    <details open={open} className="min-w-0 rounded-md border border-line p-4 md:col-span-2">
      <summary className="cursor-pointer text-sm font-medium wrap-break-word">
        AI settings <span className="font-normal text-muted">· {value.ideas} ideas, {value.copy} copy versions, {value.static_concepts} image concepts, {value.script_duration}s video</span>
      </summary>
      <input type="hidden" name="s_present" value="1" />
      <div className="mt-4 space-y-5">
        {groups.map((g) => (
          <fieldset key={g.title} className="min-w-0">
            <legend className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{g.title}</legend>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.keys.map((k) => {
                const f = SETTING_FIELDS[k];
                return (
                  <label key={k}>
                    {f.label}
                    <select name={`s_${k}`} defaultValue={String(value[k])}>
                      {f.choices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                          {"suffix" in f ? f.suffix : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">What the AI should build</legend>
          <p className="mb-3 text-xs text-muted">{TOOL_NAMES.ideas} and {TOOL_NAMES.copy} always run. {TOOL_NAMES.ugc} and {TOOL_NAMES.edit} need {TOOL_NAMES.script}.</p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {AGENT_TOGGLES.map((t) => (
              <label key={t.key} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-ink hover:bg-surface-2">
                <input type="checkbox" name={`s_${t.key}`} defaultChecked={value[t.key]} />
                <span className="min-w-0 wrap-break-word">{t.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </details>
  );
}
