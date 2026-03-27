import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { detectArchetype } from "../detect-archetype.js";
import { loadConfig } from "../config.js";

const TMP = join(__dirname, ".tmp-test-detect");

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

function writePkg(
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
) {
  writeFileSync(
    join(TMP, "package.json"),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
  );
}

describe("detectArchetype", () => {
  it("detects nextjs-app from next dependency", () => {
    setup();
    try {
      writePkg({ next: "14.0.0", react: "18.0.0" });
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "nextjs-app");
      assert.ok(result.reason.includes("next"));
    } finally {
      teardown();
    }
  });

  it("detects react-app from react without next", () => {
    setup();
    try {
      writePkg({ react: "18.0.0" });
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "react-app");
      assert.ok(result.reason.includes("react"));
    } finally {
      teardown();
    }
  });

  it("detects ts-lib from package.json without react/next", () => {
    setup();
    try {
      writePkg({ lodash: "4.0.0" });
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "ts-lib");
    } finally {
      teardown();
    }
  });

  it("detects next in devDependencies", () => {
    setup();
    try {
      writePkg({}, { next: "14.0.0" });
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "nextjs-app");
    } finally {
      teardown();
    }
  });

  it("detects rust-cli from Cargo.toml", () => {
    setup();
    try {
      writeFileSync(join(TMP, "Cargo.toml"), '[package]\nname = "foo"\n');
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "rust-cli");
    } finally {
      teardown();
    }
  });

  it("detects go-service from go.mod", () => {
    setup();
    try {
      writeFileSync(join(TMP, "go.mod"), "module example.com/foo\n");
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "go-service");
    } finally {
      teardown();
    }
  });

  it("detects python-app from requirements.txt", () => {
    setup();
    try {
      writeFileSync(join(TMP, "requirements.txt"), "flask==2.0\n");
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "python-app");
    } finally {
      teardown();
    }
  });

  it("detects python-app from pyproject.toml", () => {
    setup();
    try {
      writeFileSync(join(TMP, "pyproject.toml"), '[project]\nname = "foo"\n');
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "python-app");
    } finally {
      teardown();
    }
  });

  it("falls back to ts-lib when nothing matches", () => {
    setup();
    try {
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "ts-lib");
      assert.ok(result.reason.includes("default"));
    } finally {
      teardown();
    }
  });

  it("package.json takes priority over Cargo.toml", () => {
    setup();
    try {
      writePkg({ react: "18.0.0" });
      writeFileSync(join(TMP, "Cargo.toml"), "[package]\n");
      const result = detectArchetype(TMP);
      assert.equal(result.archetype, "react-app");
    } finally {
      teardown();
    }
  });
});

describe("loadConfig auto-detection", () => {
  it("auto-detects archetype when factory.yaml has no archetype", () => {
    setup();
    try {
      writePkg({ next: "14.0.0" });
      writeFileSync(join(TMP, "factory.yaml"), "max_crews: 3\n");
      const result = loadConfig(TMP);
      assert.equal(result.valid, true);
      assert.equal(result.config.archetype, "nextjs-app");
      assert.equal(result.archetypeSource, "detected");
      assert.equal(result.config.max_crews, 3);
    } finally {
      teardown();
    }
  });

  it("explicit factory.yaml archetype overrides detection", () => {
    setup();
    try {
      writePkg({ next: "14.0.0" });
      writeFileSync(join(TMP, "factory.yaml"), "archetype: rust-cli\n");
      const result = loadConfig(TMP);
      assert.equal(result.valid, true);
      assert.equal(result.config.archetype, "rust-cli");
      assert.equal(result.archetypeSource, "explicit");
    } finally {
      teardown();
    }
  });

  it("auto-detects when no factory.yaml exists", () => {
    setup();
    try {
      writePkg({ react: "18.0.0" });
      const result = loadConfig(TMP);
      assert.equal(result.valid, true);
      assert.equal(result.config.archetype, "react-app");
      assert.equal(result.archetypeSource, "detected");
    } finally {
      teardown();
    }
  });
});
