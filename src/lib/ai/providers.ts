/**
 * LLM provider adapters. Each adapter takes a system + user prompt and returns raw text.
 * Business modules never call these directly — they go through generateStructured()
 * (./generate.ts), which handles JSON parsing, schema validation, retries and logging.
 *
 * Credentials are read from server-side env only; nothing here is importable by client code.
 */

export type ProviderId = "gemini" | "openrouter" | "ollama" | "mock";

export interface LLMRequest {
  system: string;
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface LLMResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMProvider {
  id: ProviderId;
  model: string;
  /** True for the mock: output is template-based, not AI-generated. */
  isMock: boolean;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function postJSON(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new ProviderError(name === "TimeoutError" ? `Timed out after ${timeoutMs}ms` : `Network error: ${(e as Error).message}`, true);
  }
  if (!res.ok) {
    // Never echo the request (it may contain keys); keep a short, safe excerpt of the response.
    const excerpt = (await res.text().catch(() => "")).slice(0, 300);
    throw new ProviderError(`HTTP ${res.status}: ${excerpt}`, res.status === 429 || res.status >= 500);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function geminiProvider(apiKey: string, model: string): LLMProvider {
  return {
    id: "gemini",
    model,
    isMock: false,
    async complete({ system, prompt, temperature = 0.9, timeoutMs = 60_000 }) {
      const data: any = await postJSON(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature, responseMimeType: "application/json" },
        },
        { "x-goog-api-key": apiKey },
        timeoutMs,
      );
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      if (!text) throw new ProviderError(`Empty response (finishReason: ${data.candidates?.[0]?.finishReason ?? "unknown"})`, true);
      return { text, inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount };
    },
  };
}

export function openRouterProvider(apiKey: string, model: string): LLMProvider {
  return {
    id: "openrouter",
    model,
    isMock: false,
    async complete({ system, prompt, temperature = 0.9, timeoutMs = 90_000 }) {
      const data: any = await postJSON(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model,
          temperature,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        },
        { authorization: `Bearer ${apiKey}`, "x-title": "CerealBox AI Studio (prototype)" },
        timeoutMs,
      );
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new ProviderError("Empty response", true);
      return { text, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens };
    },
  };
}

/**
 * Ollama — local daemon (no key) or Ollama Cloud (https://ollama.com, Bearer OLLAMA_API_KEY).
 * Both speak the same native /api/chat API, so one adapter covers both.
 */
export function ollamaProvider(baseUrl: string, model: string, apiKey?: string): LLMProvider {
  return {
    id: "ollama",
    model: apiKey ? `${model} (cloud)` : model,
    isMock: false,
    async complete({ system, prompt, temperature = 0.9, timeoutMs = 180_000 }) {
      const data: any = await postJSON(
        `${baseUrl.replace(/\/$/, "")}/api/chat`,
        {
          model,
          stream: false,
          format: "json",
          options: { temperature },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        },
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        timeoutMs,
      );
      const text = data.message?.content;
      if (!text) throw new ProviderError("Empty response", true);
      return { text, inputTokens: data.prompt_eval_count, outputTokens: data.eval_count };
    },
  };
}

/** Mock provider: never called for text — generateStructured() uses the task's mock builder instead. */
export const mockProvider: LLMProvider = {
  id: "mock",
  model: "template-v1",
  isMock: true,
  async complete() {
    throw new ProviderError("Mock provider has no free-text mode; supply a mock builder.", false);
  },
};

/**
 * Provider selection. AI_PROVIDER forces one; otherwise the first configured provider wins
 * (Ollama Cloud → Gemini → OpenRouter),
 * falling back to the mock so the demo always runs. Model IDs are env-configurable because
 * hosted model names change — verify current IDs before a demo (see docs/AI_PROVIDERS.md).
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const forced = env.AI_PROVIDER as ProviderId | undefined;
  const gemini = () => (env.GEMINI_API_KEY ? geminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-3.8-flash") : null);
  const openrouter = () =>
    env.OPENROUTER_API_KEY ? openRouterProvider(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free") : null;
  const ollama = () =>
    env.OLLAMA_API_KEY
      ? ollamaProvider(env.OLLAMA_BASE_URL || "https://ollama.com", env.OLLAMA_MODEL || "gpt-oss:120b", env.OLLAMA_API_KEY)
      : env.OLLAMA_MODEL
        ? ollamaProvider(env.OLLAMA_BASE_URL || "http://localhost:11434", env.OLLAMA_MODEL)
        : null;

  if (forced === "mock") return mockProvider;
  if (forced) {
    const p = { gemini, openrouter, ollama }[forced]?.();
    if (!p) throw new Error(`AI_PROVIDER=${forced} but its credentials/model are not configured`);
    return p;
  }
  return ollama() ?? gemini() ?? openrouter() ?? mockProvider;
}
