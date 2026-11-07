import { describe, expect, it } from "vitest";
import { MAP_EMBED_PATTERN, SETTINGS_DEFAULTS, SETTINGS_SCHEMAS, mapEmbedFromInput, parseSection } from "@/lib/settings-schema";

const embed = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1345.89!2d73.716!3d22.034!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sin!4v1794028366375";
const biz = (mapEmbedUrl: unknown) => SETTINGS_SCHEMAS.business.safeParse({ ...SETTINGS_DEFAULTS.business, mapEmbedUrl });

describe("the shop map setting", () => {
  it("ships with the shop's own map", () => {
    expect(SETTINGS_DEFAULTS.business.mapEmbedUrl).toMatch(MAP_EMBED_PATTERN);
    expect(parseSection("business", {}).mapEmbedUrl).toBe(SETTINGS_DEFAULTS.business.mapEmbedUrl);
  });

  it("accepts the address, or the whole <iframe> snippet Google gives, and reads the src from it", () => {
    expect(biz(embed)).toMatchObject({ success: true, data: { mapEmbedUrl: embed } });
    const snippet = `<iframe src="${embed}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    expect(biz(snippet)).toMatchObject({ success: true, data: { mapEmbedUrl: embed } });
    expect(mapEmbedFromInput(`<iframe src='${embed.replace(/&/g, "&amp;")}'></iframe>`)).toBe(embed);
  });

  it("can be left empty (no map, just the links)", () => {
    expect(biz("")).toMatchObject({ success: true, data: { mapEmbedUrl: "" } });
    expect(biz("   ")).toMatchObject({ success: true, data: { mapEmbedUrl: "" } });
  });

  it("refuses anything that isn't a Google Maps embed address, because it goes into a frame on the public site", () => {
    for (const bad of [
      "https://evil.example/maps/embed?pb=!1m18!1m12!1m3",
      "http://www.google.com/maps/embed?pb=!1m18!1m12!1m3",
      "https://www.google.com.evil.example/maps/embed?pb=!1m18!1m12!1m3",
      "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3\"><script>alert(1)</script>",
      "https://www.google.com/maps?q=Naswadi",
      "javascript:alert(1)",
      "<iframe src=\"https://evil.example/\"></iframe>",
      "<script>alert(1)</script>",
    ]) {
      expect(biz(bad).success, bad).toBe(false);
    }
  });
});
