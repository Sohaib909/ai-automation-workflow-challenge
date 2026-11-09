import { describe, expect, it } from "vitest";
import { isGenericNote, parseButtonNote, promptWithNote } from "@/lib/agents/static-notes";

describe("parseButtonNote", () => {
  it.each([
    "remove learn more buton from this image",
    "can u remove the learn more button",
    "remove learn more button from this image",
    "Hide the CTA",
    "no button please",
  ])("hides the button and leaves no image change: %s", (note) => {
    expect(parseButtonNote(note)).toEqual({ showCta: false, rest: "" });
  });

  it("keeps the rest of the note for the image", () => {
    expect(parseButtonNote("remove the learn more button, and use warmer evening light")).toEqual({ showCta: false, rest: "use warmer evening light" });
  });

  it("can bring the button back", () => {
    expect(parseButtonNote("add the button back").showCta).toBe(true);
  });

  it.each(["change the image", "try again", "new one please", "regenerate this image"])("treats a vague note as 'just a new variation': %s", (n) => {
    expect(isGenericNote(n)).toBe(true);
    expect(parseButtonNote(n).rest).toBe("");
  });

  it("applies only the latest note to the original prompt (no stacking)", () => {
    const c = { image_prompt: "Calf in a field at dawn." };
    const once = promptWithNote(c, "warmer light");
    const twice = promptWithNote({ ...c, ...once }, "show the calf's face");
    expect(once.image_prompt).toBe("Calf in a field at dawn. warmer light");
    expect(twice.image_prompt).toBe("Calf in a field at dawn. show the calf's face");
    expect(twice.base_prompt).toBe("Calf in a field at dawn.");
  });

  it("passes image-only notes through untouched", () => {
    expect(parseButtonNote("show the calf's face more clearly")).toEqual({ showCta: undefined, rest: "show the calf's face more clearly" });
  });
});
