import "server-only";
import type { z } from "zod";
import { getDb, now } from "../db";
import { type LLMProvider, ProviderError, resolveProvider } from "./providers";

export interface Generated<T> {
  data: T;
  provider: string;
  model: string;
  isMock: boolean;
}

export class AIGenerationError extends Error {}

/** Extract a JSON value from model text (tolerates ```json fences and leading prose). */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Response was not valid JSON");
  }
}

/**
 * The single entry point for structured AI output.
 *  1. Calls the configured provider (or the task's mock builder when no provider is configured).
 *  2. Parses JSON and validates it against the Zod schema.
 *  3. On invalid output, retries once with the validation error fed back to the model.
 *     Retryable transport errors (timeouts, 429, 5xx) also get one retry.
 *  4. Logs provider, model, latency, tokens and errors to ai_logs.
 * It never silently falls back to mock output when a real provider fails — the user sees the error.
 */
export async function generateStructured<S extends z.ZodType>(opts: {
  task: string;
  schema: S;
  system: string;
  prompt: string;
  mock: () => z.infer<S>;
  temperature?: number;
  provider?: LLMProvider;
}): Promise<Generated<z.infer<S>>> {
  const provider = opts.provider ?? resolveProvider();
  const started = Date.now();
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let lastError = "";

  const log = (status: string, error?: string) =>
    getDb()
      .prepare(
        "INSERT INTO ai_logs (task, provider, model, status, attempts, latency_ms, input_tokens, output_tokens, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(opts.task, provider.id, provider.model, status, attempts, Date.now() - started, inputTokens || null, outputTokens || null, error ?? null, now());

  if (provider.isMock) {
    attempts = 1;
    const data = opts.schema.parse(opts.mock());
    log("success");
    return { data, provider: provider.id, model: provider.model, isMock: true };
  }

  let prompt = opts.prompt;
  while (attempts < 2) {
    attempts++;
    try {
      const res = await provider.complete({ system: opts.system, prompt, temperature: opts.temperature });
      inputTokens += res.inputTokens ?? 0;
      outputTokens += res.outputTokens ?? 0;
      let parsed: unknown;
      try {
        parsed = extractJSON(res.text);
      } catch (e) {
        lastError = (e as Error).message;
        prompt = `${opts.prompt}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object.`;
        continue;
      }
      const result = opts.schema.safeParse(parsed);
      if (result.success) {
        log(attempts > 1 ? "success_after_retry" : "success");
        return { data: result.data, provider: provider.id, model: provider.model, isMock: false };
      }
      lastError = `Schema validation failed: ${result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`;
      prompt = `${opts.prompt}\n\nYour previous reply failed validation (${lastError}). Fix it and reply with ONLY the corrected JSON.`;
    } catch (e) {
      lastError = (e as Error).message;
      if (!(e instanceof ProviderError && e.retryable)) break;
    }
  }
  log("failed", lastError);
  throw new AIGenerationError(`${provider.id}/${provider.model} failed after ${attempts} attempt(s): ${lastError}`);
}

/** Safe description of the active provider for the UI (never includes secrets). */
export function providerStatus() {
  try {
    const p = resolveProvider();
    return { id: p.id, model: p.model, isMock: p.isMock, error: null as string | null };
  } catch (e) {
    return { id: "unconfigured", model: "-", isMock: false, error: (e as Error).message };
  }
}
