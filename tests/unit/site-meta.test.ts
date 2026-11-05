import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS } from "@/lib/settings-schema";
import { businessJsonLd, jsonLdHtml } from "@/lib/site-meta";

const site = "https://shop.example";
const map = "https://maps.example/om-enterprise";
const business = SETTINGS_DEFAULTS.business;

describe("businessJsonLd", () => {
  it("describes the shop from the business settings", () => {
    expect(businessJsonLd(business, { site, map })).toEqual({
      "@context": "https://schema.org",
      "@type": "HardwareStore",
      "@id": "https://shop.example/#shop",
      name: "OM ENTERPRISE",
      url: "https://shop.example/",
      logo: "https://shop.example/brand/om-enterprise-logo.png",
      image: "https://shop.example/brand/om-enterprise-logo.png",
      telephone: "+91 76219 34414",
      email: "omenterprise1119@gmail.com",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Nr. Shivani Showroom, Bodeli Road",
        addressLocality: "Naswadi",
        addressRegion: "Gujarat",
        postalCode: "391150",
        addressCountry: "IN",
      },
      hasMap: map,
    });
  });

  it("leaves out details the shop has not entered, and adds no hours or ratings", () => {
    // Opening hours are free text in the settings, not schema.org's format, so they are not sent.
    const data = JSON.parse(jsonLdHtml(businessJsonLd({ ...business, phone: "", email: "", openingHours: "9 am to 8 pm" }, { site, map })));
    for (const key of ["telephone", "email", "openingHours", "openingHoursSpecification", "aggregateRating", "review", "priceRange"]) {
      expect(data).not.toHaveProperty(key);
    }
    expect(data.address.streetAddress).toBe("Nr. Shivani Showroom, Bodeli Road");
  });

  it("joins both address lines", () => {
    expect(businessJsonLd({ ...business, addressLine2: "Opp. Bus Stand" }, { site, map }).address.streetAddress).toBe("Nr. Shivani Showroom, Bodeli Road, Opp. Bus Stand");
  });
});

describe("jsonLdHtml", () => {
  it("cannot close its script tag", () => {
    const name = "</script><script>alert(1)</script>";
    const html = jsonLdHtml(businessJsonLd({ ...business, name }, { site, map }));
    expect(html).not.toContain("<");
    expect(JSON.parse(html).name).toBe(name);
  });
});
