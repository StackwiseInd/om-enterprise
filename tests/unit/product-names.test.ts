import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawingKind } from "@/components/public/technical-drawing";
import { KeepCodes } from "@/components/public/keep-codes";

describe("drawingKind", () => {
  it("draws angular stop cocks and angle valves as angle cocks", () => {
    expect(drawingKind("Aris Angular Stop Cock with Wall Flange MFLT-105 (Mini Florentine)", "bath")).toBe("angle");
    expect(drawingKind("Aris 2-Way Angular Stop Cock with Wall Flange MFLT-106", "bath")).toBe("angle");
    expect(drawingKind("Blues AC-27 Angle Valve (Ace Collection)", "bath")).toBe("angle");
    expect(drawingKind("Plumber Angle Cock EC-0507 (Economy)", "bath")).toBe("angle");
  });

  it("keeps other valves and taps as before", () => {
    expect(drawingKind("Finolex CPVC Ball Valve", "pipe")).toBe("valve");
    expect(drawingKind("Aris Bib Cock with Wall Flange MFLT-101", "bath")).toBe("tap");
    expect(drawingKind("Aris Pillar Cock MFLT-103", "bath")).toBe("pillar");
  });

  it("draws 45° elbows and bends at 45°, and every other elbow at 90°", () => {
    expect(drawingKind("Finolex ASTM Elbow 45°", "pipe")).toBe("elbow-45");
    expect(drawingKind("Finolex CPVC Schedule 80 Elbow 45°", "pipe")).toBe("elbow-45");
    expect(drawingKind("Finolex SWR Bend 45° Plain", "drain")).toBe("elbow-45");
    expect(drawingKind("Finolex SWR Selfit Bend 45° Double Socket", "drain")).toBe("elbow-45");
    expect(drawingKind("Truflo CPVC Bend 45° Plain", "pipe")).toBe("elbow-45");
    expect(drawingKind("UPVC 45 Degree Elbow", "pipe")).toBe("elbow-45");
    expect(drawingKind("PVC Bend 45 Plain", "pipe")).toBe("elbow-45");

    expect(drawingKind("Finolex CPVC Elbow 90°", "pipe")).toBe("elbow");
    expect(drawingKind("Finolex ASTM Reducing Elbow 90° – Brass Insert", "pipe")).toBe("elbow");
    expect(drawingKind("Finolex CPVC Sweep Bend", "pipe")).toBe("elbow");
    expect(drawingKind("Finolex SWR Bend 87.5° Plain", "drain")).toBe("elbow");
    expect(drawingKind("PVC Elbow 45 mm", "pipe")).toBe("elbow");
  });
});

describe("KeepCodes", () => {
  const html = (text: string) => renderToStaticMarkup(createElement(KeepCodes, { text }));

  it("keeps model codes on one line", () => {
    expect(html("Aris Bib Cock MFLT-101 (Mini Florentine)")).toBe(
      'Aris Bib Cock <span class="whitespace-nowrap">MFLT-101</span> (Mini Florentine)',
    );
    expect(html("2-Way Bib Cock EC-0209")).toBe(
      '<span class="whitespace-nowrap">2-Way</span> Bib Cock <span class="whitespace-nowrap">EC-0209</span>',
    );
  });

  it("leaves names without codes, and hyphenated words, untouched", () => {
    expect(html("Wall Mixer Non-Telephonic Shower System")).toBe("Wall Mixer Non-Telephonic Shower System");
    expect(html("Berger Silk Glamor")).toBe("Berger Silk Glamor");
  });
});
