import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseTasks, formatTaskForAgent } from "../tasks.js";

const TMP = join(__dirname, ".tmp-test-tasks");

function setup() {
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

function writeProgramMd(content: string): string {
  const path = join(TMP, "PROGRAM.md");
  writeFileSync(path, content, "utf-8");
  return path;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("parseTasks", () => {
  it("extracts checkbox items", () => {
    setup();
    try {
      const path = writeProgramMd(
        "- [ ] Build the auth module\n- [ ] Write tests for auth\n",
      );
      const result = parseTasks(path);
      assert.equal(result.tasks.length, 2);
      assert.equal(result.tasks[0]?.description, "Build the auth module");
      assert.equal(result.tasks[1]?.description, "Write tests for auth");
    } finally {
      teardown();
    }
  });

  it("computes SHA-256 hashes", () => {
    setup();
    try {
      const path = writeProgramMd("- [ ] Build the auth module\n");
      const result = parseTasks(path);
      assert.equal(result.tasks[0]?.hash, sha256("Build the auth module"));
    } finally {
      teardown();
    }
  });

  it("deduplicates by hash", () => {
    setup();
    try {
      const path = writeProgramMd(
        "- [ ] Same task\n- [ ] Same task\n- [ ] Different task\n",
      );
      const result = parseTasks(path);
      assert.equal(result.tasks.length, 2);
    } finally {
      teardown();
    }
  });

  it("captures nested context", () => {
    setup();
    try {
      const path = writeProgramMd(
        "- [ ] Build the auth module\n  - Use JWT tokens\n  - Support refresh tokens\n",
      );
      const result = parseTasks(path);
      assert.equal(result.tasks.length, 1);
      assert.equal(result.tasks[0]?.context.length, 2);
    } finally {
      teardown();
    }
  });

  it("skips completed checkboxes", () => {
    setup();
    try {
      const path = writeProgramMd("- [x] Already done\n- [ ] Still pending\n");
      const result = parseTasks(path);
      assert.equal(result.tasks.length, 1);
      assert.equal(result.tasks[0]?.description, "Still pending");
    } finally {
      teardown();
    }
  });

  it("throws on missing file", () => {
    assert.throws(
      () => parseTasks("/nonexistent/PROGRAM.md"),
      /does not exist/,
    );
  });

  it("throws on empty file (no checkboxes)", () => {
    setup();
    try {
      const path = writeProgramMd("# My Project\n\nSome notes.\n");
      assert.throws(() => parseTasks(path), /No tasks found/);
    } finally {
      teardown();
    }
  });
});

describe("formatTaskForAgent", () => {
  it("formats task with context", () => {
    const content = formatTaskForAgent({
      hash: "abc",
      description: "Build auth",
      context: ["  - Use JWT", "  - Support refresh"],
    });
    assert.ok(content.includes("# Task"));
    assert.ok(content.includes("Build auth"));
    assert.ok(content.includes("## Context"));
    assert.ok(content.includes("Use JWT"));
  });

  it("formats task without context", () => {
    const content = formatTaskForAgent({
      hash: "abc",
      description: "Simple task",
      context: [],
    });
    assert.ok(content.includes("Simple task"));
    assert.ok(!content.includes("## Context"));
  });
});
