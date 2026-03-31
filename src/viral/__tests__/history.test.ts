import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { HistoryEntry } from "../../scan/types.js";

/**
 * history.ts uses process.env.HOME to resolve ~/.xray/history.jsonl.
 * We override HOME per-test to isolate from the real user's history.
 *
 * Because the module caches XRAY_DIR at import time using process.env.HOME,
 * we need to set HOME before importing. We use dynamic import to handle this.
 */

const TMP = join(__dirname, ".tmp-test-history");

function makeEntry(
  score: number,
  ts: string = new Date().toISOString(),
): HistoryEntry {
  return {
    timestamp: ts,
    action: "scan",
    repo: "/tmp/test-repo",
    overall_score: score,
    dimensions_scored: 4,
  };
}

describe("history module", () => {
  let origHome: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(TMP, { recursive: true, force: true });
  });

  it("appendHistory creates .xray dir and writes entries", async () => {
    // Dynamic import to pick up the current HOME
    const { appendHistory } = await import("../history.js");

    const xrayDir = join(TMP, "fake-home", ".xray");
    const historyFile = join(xrayDir, "history.jsonl");

    const entry = makeEntry(75);
    appendHistory(entry);

    assert.ok(existsSync(xrayDir), ".xray directory should be created");
    assert.ok(existsSync(historyFile), "history.jsonl should be created");

    const content = readFileSync(historyFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    assert.equal(parsed.overall_score, 75);
  });

  it("appendHistory appends multiple entries", async () => {
    const { appendHistory } = await import("../history.js");

    appendHistory(makeEntry(50));
    appendHistory(makeEntry(60));
    appendHistory(makeEntry(70));

    const historyFile = join(TMP, "fake-home", ".xray", "history.jsonl");
    const lines = readFileSync(historyFile, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    assert.equal(lines.length, 3);
  });

  it("readHistory returns empty array when no file exists", async () => {
    const { readHistory } = await import("../history.js");
    const entries = readHistory();
    assert.deepEqual(entries, []);
  });

  it("readHistory returns entries from file", async () => {
    const { appendHistory, readHistory } = await import("../history.js");

    appendHistory(makeEntry(40));
    appendHistory(makeEntry(60));
    appendHistory(makeEntry(80));

    const entries = readHistory();
    assert.equal(entries.length, 3);
    assert.equal(entries[0]!.overall_score, 40);
    assert.equal(entries[2]!.overall_score, 80);
  });

  it("readHistory respects limit parameter", async () => {
    const { appendHistory, readHistory } = await import("../history.js");

    for (let i = 0; i < 10; i++) {
      appendHistory(makeEntry(i * 10));
    }

    const entries = readHistory(3);
    assert.equal(entries.length, 3);
    // Should return the LAST 3 entries
    assert.equal(entries[0]!.overall_score, 70);
    assert.equal(entries[1]!.overall_score, 80);
    assert.equal(entries[2]!.overall_score, 90);
  });
});

describe("renderHistory", () => {
  it("returns message when no entries", async () => {
    const { renderHistory } = await import("../history.js");
    const output = renderHistory([]);
    assert.ok(output.includes("No history yet"));
  });

  it("renders ASCII sparkline for entries", async () => {
    const { renderHistory } = await import("../history.js");

    const entries: HistoryEntry[] = [
      makeEntry(30, "2026-03-25T10:00:00Z"),
      makeEntry(50, "2026-03-26T10:00:00Z"),
      makeEntry(70, "2026-03-27T10:00:00Z"),
    ];

    const output = renderHistory(entries);
    assert.ok(output.includes("X-Ray"), "should include X-Ray header");
    assert.ok(output.includes("Score History"), "should include Score History");
    assert.ok(output.includes("*"), "should include sparkline characters");
    assert.ok(output.includes("|"), "should include Y-axis separator");
    assert.ok(output.includes("+"), "should include X-axis marker");
  });

  it("handles single entry", async () => {
    const { renderHistory } = await import("../history.js");
    const entries = [makeEntry(50, "2026-03-25T10:00:00Z")];
    const output = renderHistory(entries);
    assert.ok(output.includes("*"));
    assert.ok(output.includes("Score History"));
  });

  it("handles entries with same score", async () => {
    const { renderHistory } = await import("../history.js");

    const entries: HistoryEntry[] = [
      makeEntry(50, "2026-03-25T10:00:00Z"),
      makeEntry(50, "2026-03-26T10:00:00Z"),
      makeEntry(50, "2026-03-27T10:00:00Z"),
    ];

    // Should not throw even when range is 0 (uses min range of 10)
    const output = renderHistory(entries);
    assert.ok(output.includes("*"));
  });

  it("renders date labels", async () => {
    const { renderHistory } = await import("../history.js");

    const entries: HistoryEntry[] = [
      makeEntry(30, "2026-03-25T10:00:00Z"),
      makeEntry(50, "2026-03-26T10:00:00Z"),
      makeEntry(70, "2026-03-27T10:00:00Z"),
    ];

    const output = renderHistory(entries);
    // Dates should be formatted as M/D
    assert.ok(output.includes("3/25"));
    assert.ok(output.includes("3/27"));
  });
});
