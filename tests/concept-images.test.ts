import { describe, expect, it, vi } from "vitest";

// Fake image service: each call takes a moment, like the real one, and returns a unique URL.
vi.mock("@/lib/images", async (orig) => {
  const real = await orig<typeof import("@/lib/images")>();
  let n = 0;
  return {
    ...real,
    imageProvider: () => "pollinations" as const,
    generateAdImage: vi.fn(async (prompt: string) => {
      await new Promise((r) => setTimeout(r, 30));
      return { url: `/fake/${++n}.jpg#${encodeURIComponent(prompt.slice(-20))}`, width: 1024, height: 1024, provider: "pollinations", ms: 30 };
    }),
  };
});

import { getDb } from "@/lib/db";
import { ensureSampleClients } from "@/lib/schema";
import * as creative from "@/lib/creative/service";
import * as agents from "@/lib/agents/service";
import type { StaticOut } from "@/lib/agents/specs";

ensureSampleClients(getDb());

async function staticOutput(count = "3") {
  const client = creative.listClients()[0];
  const cid = creative.createCampaign({ client_id: client.id, name: "Image test", objective: "Donations", platform: "meta" });
  creative.saveBrief(cid, {
    product: "Monthly giving at £10/month",
    audience: "UK adults 30–60 who have donated before",
    pain_points: "Feel donations disappear into admin; unsure one person can help",
    offer: "£10/month monthly gift, cancel anytime",
    proof_points: "£25 funds one night of emergency accommodation (sample fact)",
    tone: "Warm, hopeful",
    cta: "Learn More",
  });
  const { ids } = await creative.generateIdeas(cid, 3);
  creative.decideIdea(ids[0], "approve", "");
  const copy = await creative.generateCopy(ids[0], 2);
  creative.decideCopy(copy.ids[0], "approve", "");
  const { id } = await agents.generateAgentOutput("static", { ideaId: ids[0], copyId: copy.ids[0], options: { count } });
  return id;
}
const concepts = (id: number) => (JSON.parse(agents.getOutput(id)!.content_json) as StaticOut).concepts;

describe("per-concept image generation", () => {
  it("making two concepts' images at the same time keeps both (no lost update)", async () => {
    const id = await staticOutput("3");
    await Promise.all([agents.generateConceptImage(id, 0), agents.generateConceptImage(id, 1)]);
    const c = concepts(id);
    expect(c[0].images?.square).toBeTruthy();
    expect(c[1].images?.square).toBeTruthy();
    expect(c[2].images?.square ?? null).toBeNull();
  });

  it("redoing one concept's image leaves the other concepts' images alone, and keeps the note", async () => {
    const id = await staticOutput("2");
    await agents.generateConceptImage(id, 0);
    await agents.generateConceptImage(id, 1);
    const before = concepts(id);
    await agents.generateConceptImage(id, 1, "warmer evening light");
    const after = concepts(id);
    expect(after[0].images?.square).toBe(before[0].images?.square);
    expect(after[1].images?.square).not.toBe(before[1].images?.square);
    expect(after[1].image_prompt).toMatch(/warmer evening light$/);
  });

  it("refuses to change a version that was replaced", async () => {
    const id = await staticOutput("2");
    getDb().prepare("UPDATE agent_outputs SET status = 'archived' WHERE id = ?").run(id);
    await expect(agents.generateConceptImage(id, 0)).rejects.toThrow(/replaced/i);
  });

  it("Regenerate on image ads keeps the concepts and images, marks them for new images with the note", async () => {
    const id = await staticOutput("2");
    await agents.generateConceptImage(id, 0);
    const before = concepts(id);
    agents.decideOutput(id, "approve", "");
    const r = await agents.redoStaticImages(id, "warmer evening light");
    expect(r.redoImages).toBe(true);
    const after = concepts(id);
    expect(after.map((c) => c.name)).toEqual(before.map((c) => c.name)); // same concepts, not a new set
    expect(after[0].images?.square).toBe(before[0].images?.square); // old image kept on screen
    expect(after.every((c) => c.images?.pending)).toBe(true);
    expect(after.every((c) => c.image_prompt.endsWith("warmer evening light"))).toBe(true);
    expect(agents.getOutput(id)!.status).toBe("pending_review"); // changed work needs a fresh OK
    expect(agents.listOutputs("static", agents.getOutput(id)!.campaign_id)).toHaveLength(1); // nothing archived
    await agents.generateConceptImage(id, 0);
    expect(concepts(id)[0].images?.pending).toBeFalsy();
  });

  it("a 'remove the Learn More button' note hides the button without touching the images", async () => {
    const id = await staticOutput("2");
    await agents.generateConceptImage(id, 0);
    const before = concepts(id);
    const r = await agents.redoStaticImages(id, "can u remove the learn more button");
    expect(r).toMatchObject({ showCta: false, redoImages: false });
    const o = JSON.parse(agents.getOutput(id)!.content_json) as StaticOut;
    expect(o.show_cta).toBe(false);
    expect(o.concepts).toEqual(before);
  });
});
