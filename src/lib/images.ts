import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Image generation for Static Creative. Provider is chosen from env:
 *  - HF_TOKEN set → Hugging Face Inference, FLUX.1-schnell (free token, no watermark)
 *  - otherwise   → Pollinations (free, no key; adds a small "pollinations.ai" mark on the free tier)
 *  - IMAGE_PROVIDER=none disables image generation (concepts and prompts only)
 * Images are saved by the app and served from /api/images/<file>, so the browser loads them from the
 * same site (reliable, and the ad composer can export PNGs).
 */

export type ImageProviderId = "huggingface" | "pollinations" | "none";

/** Serverless hosts (Vercel) have no shared disk, so images are linked from the image service instead of saved. */
const linkInsteadOfSave = () => !!process.env.VERCEL || process.env.IMAGE_STORAGE === "link";

export function imageProvider(): ImageProviderId {
  const forced = process.env.IMAGE_PROVIDER as ImageProviderId | undefined;
  if (forced === "none") return "none";
  // Hugging Face returns raw image bytes that need storage; on serverless, use the linkable service.
  if (linkInsteadOfSave()) return "pollinations";
  if (forced === "huggingface" || (!forced && process.env.HF_TOKEN)) return "huggingface";
  return "pollinations";
}

export function imageDir() {
  const dir = process.env.IMAGE_DIR ?? (process.env.VERCEL ? "/tmp/cerealbox-images" : path.join(process.cwd(), "data", "images"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface GeneratedImage {
  url: string;
  width: number;
  height: number;
  provider: ImageProviderId;
  ms: number;
}

const TIMEOUT = 90_000;

export class ImageRateLimit extends Error {}

async function fetchBytes(url: string, init?: RequestInit): Promise<Buffer> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 402 || res.status === 429)
    throw new ImageRateLimit(
      imageProvider() === "pollinations"
        ? "The free image service allows one image every 45 seconds. Wait a moment, then click Generate image."
        : "The image service is rate-limiting requests. Wait a moment and try again.",
    );
  if (!res.ok) throw new Error(`Image service error (HTTP ${res.status}): ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`Expected an image, got ${type || "unknown content"}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Generate one image and store it. Retries once on failure (these free services are occasionally busy). */
export async function generateImage(prompt: string, width: number, height: number, seed: number): Promise<GeneratedImage> {
  const provider = imageProvider();
  if (provider === "none") throw new Error("Image generation is turned off (IMAGE_PROVIDER=none).");
  const clean = prompt.replace(/\s+/g, " ").slice(0, 900);
  const started = Date.now();
  const q = new URLSearchParams({ width: String(width), height: String(height), seed: String(seed), nologo: "true", model: process.env.POLLINATIONS_MODEL ?? "flux" });
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(clean)}?${q}`;

  const once = async () => {
    if (provider === "huggingface") {
      const url = process.env.HF_IMAGE_URL ?? "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell";
      return fetchBytes(url, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.HF_TOKEN}`, "content-type": "application/json", accept: "image/png" },
        body: JSON.stringify({ inputs: clean, parameters: { width, height, seed } }),
      });
    }
    const headers: Record<string, string> = process.env.POLLINATIONS_TOKEN ? { authorization: `Bearer ${process.env.POLLINATIONS_TOKEN}` } : {};
    return fetchBytes(pollinationsUrl, { headers });
  };

  let bytes: Buffer;
  try {
    bytes = await once();
  } catch (e) {
    if (e instanceof ImageRateLimit) throw e; // retrying immediately would hit the same limit
    bytes = await once();
  }
  // The request above generated and cached the image; on serverless we link to it rather than save it.
  if (linkInsteadOfSave() && provider === "pollinations") return { url: pollinationsUrl, width, height, provider, ms: Date.now() - started };
  const ext = bytes[0] === 0x89 ? "png" : "jpg";
  const name = `${createHash("sha1").update(`${provider}|${clean}|${width}x${height}|${seed}`).digest("hex").slice(0, 20)}.${ext}`;
  fs.writeFileSync(path.join(imageDir(), name), bytes);
  return { url: `/api/images/${name}`, width, height, provider, ms: Date.now() - started };
}

/** Is image generation available at all (not turned off)? */
export const imagesEnabled = () => imageProvider() !== "none";

/**
 * Saved images can disappear (data folder cleared, store moved to another machine, serverless /tmp reset).
 * Treat a concept whose stored file is gone as having no image, so the page offers / auto-makes a new one
 * instead of silently showing the plain brand background.
 */
export function withLiveImages<T extends { concepts: { images?: { square: string | null; tall: string | null; provider: string } }[] }>(o: T): T {
  const alive = (url: string | null) => {
    if (!url) return null;
    const m = /^\/api\/images\/([a-f0-9]{20}\.(?:png|jpg))$/.exec(url);
    return !m || fs.existsSync(path.join(imageDir(), m[1])) ? url : null;
  };
  return { ...o, concepts: o.concepts.map((c) => (c.images ? { ...c, images: { ...c.images, square: alive(c.images.square), tall: alive(c.images.tall) } } : c)) };
}

/** Can every concept get an image at once, or must the free anonymous tier go one at a time? */
export function canGenerateInParallel() {
  return imageProvider() === "huggingface" || !!process.env.POLLINATIONS_TOKEN;
}

const NEGATION = /^\s*(no|not|without|free of|avoid(?:ing)?|exclud(?:e|ing)|never|don'?t|do not|negative(?: prompt)?|remove|removing|delete|erase|hide|get rid of|take (?:out|away|off))\b/i;

/**
 * FLUX-style models have no negative prompt: every word in the prompt pulls the picture towards it, so
 * "no watermarks, UI buttons or cartoon style" tends to ADD watermarks, buttons and cartoons. Keep only
 * what should be in the picture: drop negated sentences ("Avoid: …") and negated list items ("no text").
 */
export function cleanImagePrompt(prompt: string): string {
  const sentences = prompt.replace(/\s+/g, " ").split(/(?<=[.;])\s+/);
  const kept = sentences
    .filter((s) => !NEGATION.test(s) && !/\b(avoid|exclude|negative prompt)\s*:/i.test(s))
    .map((s) => {
      const parts = s.split(",");
      const out: string[] = [];
      let dropping = false;
      for (const p of parts) {
        if (NEGATION.test(p)) dropping = true;
        // Short items right after a negation are the rest of its list: "no text, logos or watermarks".
        else if (dropping && p.trim().split(/\s+/).length <= 3) dropping = true;
        else dropping = false;
        if (!dropping) out.push(p);
      }
      return out.join(",").trim();
    })
    .filter((s) => s.replace(/[.,;\s]/g, "").length > 0);
  return kept
    .join(" ")
    // "space in the top third for the headline" makes the model draw text: keep the space, drop the reason.
    .replace(/\s*(?:for|to hold|reserved for|leaving room for)\s+(?:a|the|our)?\s*(?:headline|text|copy|title|caption|tagline|logo)s?\b/gi, "")
    .replace(/\s*,\s*([.;]|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** One square image per concept; the ad composer crops it for 4:5 and extends it (blurred) for 9:16. */
export async function generateAdImage(prompt: string, seed: number) {
  const subject = cleanImagePrompt(prompt).replace(/[.;,\s]+$/, "");
  return generateImage(`${subject}. Photorealistic advertising photograph, clean uncluttered composition, calm open space in the top third.`, 1024, 1024, seed);
}
