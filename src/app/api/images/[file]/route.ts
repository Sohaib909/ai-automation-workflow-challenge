import fs from "node:fs";
import path from "node:path";
import { imageDir } from "@/lib/images";

/** Serves generated ad images. File names are content hashes, so they can be cached forever. */
export async function GET(_req: Request, ctx: RouteContext<"/api/images/[file]">) {
  const { file } = await ctx.params;
  if (!/^[a-f0-9]{20}\.(png|jpg)$/.test(file)) return new Response("Not found", { status: 404 });
  const p = path.join(imageDir(), file);
  if (!fs.existsSync(p)) return new Response("Image not found — it may have been cleared. Regenerate the ad.", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}
