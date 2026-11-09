import { describe, expect, it } from "vitest";
import { cleanImagePrompt } from "@/lib/images";

describe("cleanImagePrompt", () => {
  it("drops 'Avoid:' sentences the image model would otherwise draw", () => {
    const p =
      "A farmer’s hand opens a feed bin at sunrise, golden light, shallow depth of field. Avoid: watermarks, graphic overlays, cartoon style, unrealistic lighting, crowded background.";
    const out = cleanImagePrompt(p);
    expect(out).toContain("farmer’s hand opens a feed bin");
    expect(out).toContain("golden light");
    expect(out).not.toMatch(/watermark|cartoon|overlay/i);
  });

  it("drops negated list items and the short items that continue the list", () => {
    const out = cleanImagePrompt("Photograph of a calf in a green field, no text, logos or watermarks, soft morning light, shot on 50mm lens");
    expect(out).toContain("calf in a green field");
    expect(out).toContain("shot on 50mm lens");
    expect(out).not.toMatch(/text|logos|watermarks/i);
  });

  it("drops whole negative sentences and 'without' clauses", () => {
    const out = cleanImagePrompt("Volunteer hands sorting food parcels in a warm hall. No people's faces visible. Without any branding, natural colours.");
    expect(out).toBe("Volunteer hands sorting food parcels in a warm hall.");
  });

  it("keeps the empty space but drops 'for a headline' (the model would draw text)", () => {
    expect(cleanImagePrompt("Calm sky occupying the top third for a headline, farmer in a field.")).toBe("Calm sky occupying the top third, farmer in a field.");
  });

  it("leaves a clean prompt unchanged", () => {
    const p = "Close-up of a smiling grandmother holding a mug of tea by a window, warm tones, natural light.";
    expect(cleanImagePrompt(p)).toBe(p);
  });

  it("drops reviewer 'remove …' notes so the model doesn't draw the removed thing", () => {
    const out = cleanImagePrompt("Rolling green farmland at golden hour, wide aerial view. remove the animal from the image and remove all text. Remove text from the image");
    expect(out).toBe("Rolling green farmland at golden hour, wide aerial view.");
  });
});
