import { describe, expect, it } from "vitest";
import { createCampaign, createClient, saveBrief } from "@/lib/creative/service";
import { suggestFields, suggestOne } from "@/lib/suggest";

describe("Fill with AI (form suggestions)", () => {
  const client = createClient({ name: "Suggest Co", sector: "Charity — animals", brand_voice: "Kind, practical.", brand_guidelines: "", banned_claims: "guaranteed" });
  const k = createCampaign({ client_id: client, name: "Spring Foster", objective: "Leads / enquiries", platform: "meta" });
  saveBrief(k, {
    product: "Foster carer sign-ups",
    audience: "Pet lovers 25–55 near Leeds",
    pain_points: "worry about cost; not enough space",
    offer: "We cover all vet bills",
    proof_points: "We have rehomed 1,200 animals since 2015\nAll vet bills covered",
    tone: "Kind, upbeat",
    cta: "Sign Up",
  });

  it("fills only empty fields and reuses facts from previous briefs (never generated)", async () => {
    const r = await suggestFields("campaign", { client_id: String(client), name: "Autumn Foster", product: "" }, { clientId: client });
    expect(r.values.name).toBeUndefined(); // user typed it
    expect(r.values.proof_points).toBe("We have rehomed 1,200 animals since 2015\nAll vet bills covered");
    expect(r.sources.proof_points).toMatch(/Reused from “Spring Foster”/);
    expect(r.values.product).toBe("Foster carer sign-ups");
    expect(r.values.cta).toBe("Sign Up");
    expect(r.values.goal).toBe("Leads / enquiries");
  });

  it("works from the campaign for the brief form", async () => {
    const r = await suggestFields("brief", { product: "Foster carers", audience: "", offer: "", pain_points: "x", tone: "" }, { campaignId: k });
    expect(r.values.product).toBeUndefined();
    expect(r.values.pain_points).toBeUndefined();
    expect(r.values.audience).toBe("Pet lovers 25–55 near Leeds");
  });

  it("with no history, still helps and invents no facts", async () => {
    const r = await suggestFields("client", { name: "Brand New Ltd", sector: "", brand_voice: "", banned_claims: "" }, {});
    expect(r.values.proof_points).toBeUndefined();
    expect(Object.keys(r.values).every((k) => ["sector", "brand_voice", "banned_claims"].includes(k))).toBe(true);
  });

  it("suggests options for a single field", async () => {
    const facts = await suggestOne("proof_points", { proof_points: "All vet bills covered" }, { clientId: client });
    expect(facts.mode).toBe("append");
    expect(facts.options).toEqual(["We have rehomed 1,200 animals since 2015"]); // already-typed fact not repeated

    const goal = await suggestOne("goal", {}, { clientId: client });
    expect(goal.options[0]).toBe("Leads / enquiries"); // what this client used before comes first
    expect(goal.options).toHaveLength(3);

    const cta = await suggestOne("cta", {}, { clientId: client });
    expect(cta.options[0]).toBe("Sign Up");

    const tone = await suggestOne("tone", { tone: "Kind, upbeat" }, { clientId: client });
    expect(tone.mode).toBe("replace");
    expect(tone.options).not.toContain("Kind, upbeat"); // offers alternatives to the current value

    const none = await suggestOne("proof_points", {}, {});
    expect(none.options).toEqual([]);
    expect(none.source).toMatch(/won't make them up/);
    await expect(suggestOne("not_a_field", {}, {})).rejects.toThrow();
  });
});
