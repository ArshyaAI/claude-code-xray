import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { badgeMarkdown, badgeUrl, badgeSvg } from "../badge.js";

describe("badgeMarkdown", () => {
  it("returns green badge for score >= 71", () => {
    const md = badgeMarkdown(85);
    assert.ok(md.includes("brightgreen"));
    assert.ok(md.includes("85"));
    assert.ok(md.includes("X-Ray"));
    assert.ok(md.startsWith("!["));
  });

  it("returns yellow badge for score 41-70", () => {
    const md = badgeMarkdown(55);
    assert.ok(md.includes("yellow"));
    assert.ok(md.includes("55"));
  });

  it("returns red badge for score <= 40", () => {
    const md = badgeMarkdown(20);
    assert.ok(md.includes("red"));
    assert.ok(md.includes("20"));
  });

  it("handles boundary at 71 (green)", () => {
    assert.ok(badgeMarkdown(71).includes("brightgreen"));
  });

  it("handles boundary at 70 (yellow)", () => {
    assert.ok(badgeMarkdown(70).includes("yellow"));
  });

  it("handles boundary at 41 (yellow)", () => {
    assert.ok(badgeMarkdown(41).includes("yellow"));
  });

  it("handles boundary at 40 (red)", () => {
    assert.ok(badgeMarkdown(40).includes("red"));
  });

  it("handles score 0", () => {
    const md = badgeMarkdown(0);
    assert.ok(md.includes("red"));
    assert.ok(md.includes("0"));
  });

  it("handles score 100", () => {
    const md = badgeMarkdown(100);
    assert.ok(md.includes("brightgreen"));
    assert.ok(md.includes("100"));
  });

  it("includes shields.io URL", () => {
    const md = badgeMarkdown(50);
    assert.ok(md.includes("img.shields.io/badge"));
  });

  it("URL-encodes the score value", () => {
    const md = badgeMarkdown(50);
    // "50/100" should be encoded
    assert.ok(md.includes(encodeURIComponent("50/100")));
  });
});

describe("badgeUrl", () => {
  it("returns shields.io URL with green for high score", () => {
    const url = badgeUrl(90);
    assert.ok(url.startsWith("https://img.shields.io/badge/"));
    assert.ok(url.includes("brightgreen"));
  });

  it("returns yellow for mid-range score", () => {
    const url = badgeUrl(50);
    assert.ok(url.includes("yellow"));
  });

  it("returns red for low score", () => {
    const url = badgeUrl(10);
    assert.ok(url.includes("red"));
  });
});

describe("badgeSvg", () => {
  it("returns valid SVG with green color for high score", () => {
    const svg = badgeSvg(85);
    assert.ok(svg.includes("<svg"));
    assert.ok(svg.includes("</svg>"));
    assert.ok(svg.includes("#4c1")); // green hex
    assert.ok(svg.includes("85/100"));
    assert.ok(svg.includes("X-Ray"));
  });

  it("returns yellow color for mid-range score", () => {
    const svg = badgeSvg(55);
    assert.ok(svg.includes("#dfb317")); // yellow hex
    assert.ok(svg.includes("55/100"));
  });

  it("returns red color for low score", () => {
    const svg = badgeSvg(20);
    assert.ok(svg.includes("#e05d44")); // red hex
    assert.ok(svg.includes("20/100"));
  });

  it("green boundary at 71", () => {
    assert.ok(badgeSvg(71).includes("#4c1"));
  });

  it("yellow boundary at 70", () => {
    assert.ok(badgeSvg(70).includes("#dfb317"));
  });

  it("yellow boundary at 41", () => {
    assert.ok(badgeSvg(41).includes("#dfb317"));
  });

  it("red boundary at 40", () => {
    assert.ok(badgeSvg(40).includes("#e05d44"));
  });

  it("includes xmlns attribute", () => {
    const svg = badgeSvg(50);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  });
});
