import { describe, expect, it } from "vitest";
import { assetName, DEFAULT_NAME_PATTERNS, GameExportError } from "../src/index.js";

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GameExportError);
    expect((error as GameExportError).code).toBe("BAD_NAME");
    return (error as Error).message;
  }
  throw new Error("Expected a refusal.");
}

describe("names for a family of assets", () => {
  it("names a row the way each engine's projects name theirs", () => {
    expect(DEFAULT_NAME_PATTERNS).toEqual({ godot4: "{family}_{row}", unity6: "{Family}_{Row}", unreal5: "SM_{Family}_{Row}" });
    expect(assetName(DEFAULT_NAME_PATTERNS.unreal5, "crate", "small")).toBe("SM_Crate_Small");
    expect(assetName(DEFAULT_NAME_PATTERNS.godot4, "crate", "small")).toBe("crate_small");
    expect(assetName(DEFAULT_NAME_PATTERNS.unity6, "crate", "small")).toBe("Crate_Small");
  });

  it("gives the same name however the family and the row were typed", () => {
    for (const [family, row] of [["Crate", "Small"], ["crate", "small"], ["CRATE", "SMALL"], [" crate ", "small."]] as const) {
      expect(assetName("{family}_{row}", family, row)).toBe("crate_small");
      expect(assetName("{FAMILY}_{ROW}", family, row)).toBe("CRATE_SMALL");
    }
    expect(assetName("SM_{Family}_{Row}", "crate", "small")).toBe("SM_Crate_Small");
    expect(assetName("SM_{Family}_{Row}", "Crate", "Small")).toBe("SM_Crate_Small");
  });

  it("reads words out of spaces, dashes, underscores and capitals", () => {
    expect(assetName("{family}_{row}", "Wooden Crate", "extra-large")).toBe("wooden_crate_extra_large");
    expect(assetName("SM_{Family}_{Row}", "wooden crate", "extra_large")).toBe("SM_WoodenCrate_ExtraLarge");
    expect(assetName("{family}_{row}", "WoodenCrate", "ExtraLarge")).toBe("wooden_crate_extra_large");
    expect(assetName("{Family}_{Row}", "wall", "2x4")).toBe("Wall_2x4");
    expect(assetName("{family}_{row}", "wall", "2 x 4 m")).toBe("wall_2_x_4_m");
    // A word all in capitals is kept as it is.
    expect(assetName("SM_{Family}_{Row}", "LED lamp", "v2")).toBe("SM_LEDLamp_V2");
    // Accents are taken off, so the name is plain letters in every engine.
    expect(assetName("{family}_{row}", "Café", "Crème brûlée")).toBe("cafe_creme_brulee");
  });

  it("leaves the row and the separator in front of it out when there is no row", () => {
    expect(assetName("SM_{Family}_{Row}", "crate")).toBe("SM_Crate");
    expect(assetName("{family}_{row}", "wooden crate")).toBe("wooden_crate");
    expect(assetName("{family}-{row}", "crate")).toBe("crate");
    expect(assetName("{Row}_{Family}", "crate")).toBe("Crate");
    expect(assetName("prop_{family}", "crate", "small")).toBe("prop_crate");
  });

  it("is the same for the same input, and keeps everything else in the pattern", () => {
    expect(assetName("env_{family}_{row}_a", "crate", "small")).toBe("env_crate_small_a");
    expect(assetName("env_{family}_{row}_a", "crate", "small")).toBe(assetName("env_{family}_{row}_a", "crate", "small"));
  });

  it("refuses a pattern, a family or a row it cannot name anything by", () => {
    expect(refusal(() => assetName("", "crate"))).toContain("name pattern");
    expect(refusal(() => assetName("{row}", "crate", "small"))).toContain("needs {family}");
    expect(refusal(() => assetName("{family}_{size}", "crate", "small"))).toContain("unknown part {size}");
    expect(refusal(() => assetName("{family}", "  "))).toContain("family");
    expect(refusal(() => assetName("{family}", "!!"))).toContain("family");
    expect(refusal(() => assetName("{family}_{row}", "crate", "--"))).toContain("row");
    expect(refusal(() => assetName("{family}", 7 as never))).toContain("family");
  });
});
