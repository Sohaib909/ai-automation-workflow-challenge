import { describe, expect, it } from "vitest";
import { checkClaims, checkCta, checkLengths, extractFigures, similarity, worstLevel } from "@/lib/qc";
import { CRITERIA, IdeaBatchSchema, LENSES, buildIdeaPrompt, mockIdeas, pickLenses, totalScore, type IdeaContext } from "@/lib/ideas/logic";
import { CopyBatchSchema, mockCopy, runCopyQC } from "@/lib/copy/logic";

const ctx: IdeaContext = {
  client: { name: "Test Charity", sector: "Charity", brand_voice: "Warm", brand_guidelines: "British English.", banned_claims: "end homelessness\nguaranteed" },
  campaign: { name: "Winter", objective: "Donations", platform: "meta" },
  brief: {
    product: "Monthly giving",
    audience: "UK adults",
    pain_points: "Donations disappear into admin; one person can't help",
    offer: "£10/month, cancel anytime",
    proof_points: "£25 funds one night of emergency accommodation",
    tone: "Warm",
    cta: "Donate Now",
  },
  previous: [],
  learnings: [],
  count: 3,
};

describe("claim checks", () => {
  const c = { factSource: `${ctx.brief.offer}\n${ctx.brief.proof_points}`, bannedClaims: ["end homelessness"] };
  it("accepts figures that appear in the brief", () => {
    expect(checkClaims("Just £10 a month. £25 funds a night.", c)).toEqual([]);
  });
  it("flags figures not in the brief", () => {
    const f = checkClaims("Help 5,000 young people — 90% reach a home", c);
    expect(f.map((x) => x.code)).toContain("unsupported_figure");
    expect(f.filter((x) => x.code === "unsupported_figure")).toHaveLength(2);
  });
  it("flags banned phrases as errors and absolute claims as warnings", () => {
    const f = checkClaims("Together we can End Homelessness — guaranteed impact", c);
    expect(f.find((x) => x.code === "banned_claim")?.level).toBe("error");
    expect(f.some((x) => x.code === "absolute_claim")).toBe(true);
    expect(worstLevel(f)).toBe("error");
  });
  it("flags invented testimonials", () => {
    expect(checkClaims('"This charity changed my life completely" — Sarah', c).some((x) => x.code === "possible_testimonial")).toBe(true);
  });
  it("extracts money, percent and multi-digit figures", () => {
    expect(extractFigures("£1,200 raised, 35% more, 412 nights, 3 days")).toEqual(["£1,200", "35%", "412"]);
  });
});

describe("length and CTA checks", () => {
  it("warns on long headline, informs on long primary text", () => {
    const f = checkLengths({ headline: "x".repeat(41), primary_text: "y".repeat(200), description: "ok", hook: "ok" }, "meta");
    expect(f.find((x) => x.field === "headline")?.level).toBe("warning");
    expect(f.find((x) => x.field === "primary_text")?.level).toBe("info");
  });
  it("rejects unsupported CTA", () => {
    expect(checkCta("Donate Now")).toEqual([]);
    expect(checkCta("Click here!!")[0].level).toBe("error");
  });
});

describe("idea scoring and generation helpers", () => {
  it("weights sum to 1 and score maps 1..5 to 0..100", () => {
    expect(Object.values(CRITERIA).reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1);
    const all = (n: number) => Object.fromEntries(Object.keys(CRITERIA).map((k) => [k, { score: n, reason: "why" }])) as never;
    expect(totalScore(all(1))).toBe(0);
    expect(totalScore(all(5))).toBe(100);
    expect(totalScore(all(3))).toBe(50);
  });
  it("prefers unused lenses", () => {
    const used = [LENSES[0].name, LENSES[1].name];
    expect(pickLenses(3, used).map((l) => l.name)).not.toContain(LENSES[0].name);
  });
  it("prompt carries proof points, banned claims, learnings and previous ideas", () => {
    const p = buildIdeaPrompt(
      { ...ctx, learnings: ["Carousel ad beats average CPR by -40%"], previous: [{ title: "Old idea", hook: "h", status: "rejected", rating: 2 }] },
      pickLenses(2, []),
    );
    expect(p).toContain("£25 funds one night");
    expect(p).toContain("end homelessness");
    expect(p).toContain("Carousel ad beats average");
    expect(p).toContain('"Old idea"');
    expect(p).toContain("[rejected, rated 2/5]");
  });
  it("mock ideas satisfy the same schema as AI output", () => {
    const out = mockIdeas(ctx, pickLenses(5, []));
    expect(IdeaBatchSchema.safeParse(out).success).toBe(true);
    expect(new Set(out.ideas.map((i) => i.lens)).size).toBe(5);
  });
  it("detects near-duplicates", () => {
    expect(similarity("One night of shelter for £25", "£25 buys one night of shelter")).toBeGreaterThan(0.5);
    expect(similarity("Tea ritual mornings", "Foster a kitten this winter")).toBe(0);
  });
});

describe("copy", () => {
  it("mock copy is schema-valid and passes QC without errors", () => {
    const idea = { title: "t", lens: "Tangible impact", core_concept: "A concept. More.", hook: "Hook", copy_direction: "d", audience_insight: "i" };
    const out = mockCopy(ctx, idea, 3);
    expect(CopyBatchSchema.safeParse(out).success).toBe(true);
    for (const v of out.variations) {
      const qc = runCopyQC(v, { factSource: `${ctx.brief.offer}\n${ctx.brief.proof_points}`, bannedClaims: ["end homelessness"], platform: "meta" });
      expect(qc.filter((f) => f.level === "error")).toEqual([]);
    }
  });
});

describe("static creative QC", () => {
  it("doesn't flag negated text mentions, but flags prompts that ask for text", async () => {
    const { SPECS } = await import("@/lib/agents/specs");
    const actx = { ...ctx, idea: { title: "t", lens: "l", core_concept: "c", hook: "h", audience_insight: "a", visual_direction: "v", video_concept: "v", copy_direction: "c" }, options: {} };
    const concept = (image_prompt: string) => ({ concepts: [{ name: "A", visual_concept: "Warm room", composition: "c", image_prompt, negative_prompt: "", alt_text: "Bed" }] });
    const flagged = (p: string) => SPECS.static.qc(concept(p), actx).some((f: { code: string }) => f.code === "prompt_text");
    expect(flagged("Bedroom at dawn. No people, text, logos, or graphic elements; straight-on shot.")).toBe(false);
    expect(flagged("Warm doorway, no text or logos, low angle")).toBe(false);
    expect(flagged("A shop sign with the words HOPE written in neon")).toBe(true);
  });
});
