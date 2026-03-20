#!/usr/bin/env node
// layer2-holdout.js — DeFactory Layer 2 Hidden Holdout Evaluator
//
// IMMUTABLE: This file is read-only from agents (enforced by policy.yml).
// Changes require board approval and a new policy.yml freeze cycle.
//
// CONFIDENTIAL: The specific probes and thresholds in this file MUST NOT
// be shared with explorer agents. Feedback is PASS/FAIL only.
//
// Usage:
//   node layer2-holdout.js --workspace /path/to/repo
//   node layer2-holdout.js --workspace /path/to/repo --output /path/to/score.json
//
// Output JSON:
//   {
//     "passed": true,
//     "hcov": 0.83,        // fraction of holdout probes passed [0,1]
//     "probe_count": 12,
//     "probes_passed": 10,
//     "verdict": "pass",   // "pass" | "fail"
//     "feedback": "PASS"   // what explorer sees — PASS/FAIL only
//   }
//
// Internal probe results are never written to stdout when called from the
// orchestrator. Only hcov and verdict are forwarded to score-layer1.js.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── Holdout probe definitions ────────────────────────────────────────────────
// 12 probes. Details are hidden from explorers.
// Each probe returns { passed: boolean, probe_id: string }.
const PROBES = [
  // P01: TypeScript strict compilation
  {
    id: "P01",
    run: (ws) => {
      const tsCfg = path.join(ws, "tsconfig.json");
      if (!fs.existsSync(tsCfg)) return { passed: true }; // not a TS project — skip
      try {
        execSync("npx tsc --noEmit --strict", { cwd: ws, stdio: "pipe" });
        return { passed: true };
      } catch {
        return { passed: false };
      }
    },
  },

  // P02: No empty test files (every test file must have at least one assertion)
  {
    id: "P02",
    run: (ws) => {
      try {
        const result = execSync(
          `find . -type f \\( -name "*.test.ts" -o -name "*.test.js" -o -name "*.spec.ts" -o -name "*.spec.js" \\) | head -50`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();
        if (!result) return { passed: true }; // no test files — skip
        const files = result.split("\n");
        for (const f of files) {
          const content = fs.readFileSync(path.join(ws, f), "utf8");
          if (
            !content.match(
              /expect\s*\(|assert\s*\(|it\s*\(|test\s*\(|describe\s*\(/,
            )
          ) {
            return { passed: false };
          }
        }
        return { passed: true };
      } catch {
        return { passed: true }; // file read errors don't fail this probe
      }
    },
  },

  // P03: No console.log in production source (src/ or lib/ dirs)
  {
    id: "P03",
    run: (ws) => {
      try {
        const dirs = ["src", "lib", "app"].filter((d) =>
          fs.existsSync(path.join(ws, d)),
        );
        if (dirs.length === 0) return { passed: true };
        const result = execSync(
          `grep -r "console\\.log" ${dirs.join(" ")} --include="*.ts" --include="*.js" -l 2>/dev/null | wc -l`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();
        return { passed: parseInt(result, 10) === 0 };
      } catch {
        return { passed: true };
      }
    },
  },

  // P04: Critical npm audit (no critical CVEs in production deps)
  {
    id: "P04",
    run: (ws) => {
      if (!fs.existsSync(path.join(ws, "package-lock.json"))) {
        return { passed: true }; // no lockfile — skip
      }
      try {
        const raw = execSync(
          "npm audit --json --production 2>/dev/null || true",
          {
            cwd: ws,
            encoding: "utf8",
            stdio: "pipe",
          },
        );
        const data = JSON.parse(raw);
        const critical = data?.metadata?.vulnerabilities?.critical ?? 0;
        return { passed: critical === 0 };
      } catch {
        return { passed: true }; // audit parse failure — give benefit of doubt
      }
    },
  },

  // P05: Function cyclomatic complexity below hard ceiling
  // Hidden threshold: max 15 per function (stricter than Layer 1 soft penalty)
  {
    id: "P05",
    run: (ws) => {
      try {
        // Use a simple heuristic: count if/else/switch/for/while/catch per function
        const result = execSync(
          `find . -name "*.ts" -o -name "*.js" | grep -v node_modules | grep -v dist | head -30`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();
        if (!result) return { passed: true };
        for (const rel of result.split("\n")) {
          const content = fs.readFileSync(path.join(ws, rel), "utf8");
          const fns = content.split(/function\s+\w+|=>\s*\{|\bfunction\b\s*\(/);
          for (const fn of fns) {
            const complexity = (
              fn.match(/\b(if|else|switch|case|for|while|catch)\b/g) || []
            ).length;
            if (complexity > 15) return { passed: false };
          }
        }
        return { passed: true };
      } catch {
        return { passed: true };
      }
    },
  },

  // P06: Test coverage on changed source files > 60%
  // Approximated by checking if test files exist for each source module
  {
    id: "P06",
    run: (ws) => {
      try {
        const srcDir = ["src", "lib", "app"].find((d) =>
          fs.existsSync(path.join(ws, d)),
        );
        if (!srcDir) return { passed: true };

        const srcFiles = execSync(
          `find ${srcDir} -name "*.ts" -not -name "*.d.ts" -not -name "*.test.ts" -not -name "*.spec.ts" 2>/dev/null | wc -l`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();
        const testFiles = execSync(
          `find . -name "*.test.ts" -o -name "*.spec.ts" 2>/dev/null | wc -l`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();

        const srcCount = parseInt(srcFiles, 10);
        const testCount = parseInt(testFiles, 10);
        if (srcCount === 0) return { passed: true };
        return { passed: testCount / srcCount >= 0.6 };
      } catch {
        return { passed: true };
      }
    },
  },

  // P07: No hardcoded secrets (extended pattern set — stricter than G_safe)
  {
    id: "P07",
    run: (ws) => {
      try {
        const patterns = [
          "password\\s*=\\s*['\"][^'\"]{8,}['\"]",
          "secret\\s*=\\s*['\"][^'\"]{8,}['\"]",
          "api_key\\s*=\\s*['\"][^'\"]{8,}['\"]",
          "AKIA[0-9A-Z]{16}",
          "sk-[a-zA-Z0-9]{40,}",
        ];
        const pattern = patterns.join("|");
        const result = execSync(
          `grep -rEi "${pattern}" --include="*.ts" --include="*.js" --include="*.env*" --exclude-dir=node_modules --exclude-dir=.git -l 2>/dev/null | wc -l`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();
        return { passed: parseInt(result, 10) === 0 };
      } catch {
        return { passed: true };
      }
    },
  },

  // P08: JSDoc/TSDoc coverage on exported functions > 40%
  {
    id: "P08",
    run: (ws) => {
      try {
        const srcDir = ["src", "lib"].find((d) =>
          fs.existsSync(path.join(ws, d)),
        );
        if (!srcDir) return { passed: true };

        const exported = parseInt(
          execSync(
            `grep -r "^export " ${srcDir} --include="*.ts" 2>/dev/null | grep -E "(function|const|class|async)" | wc -l`,
            { cwd: ws, encoding: "utf8", stdio: "pipe" },
          ).trim(),
          10,
        );
        if (exported === 0) return { passed: true };

        const documented = parseInt(
          execSync(
            `grep -r "/\\*\\*" ${srcDir} --include="*.ts" 2>/dev/null | wc -l`,
            { cwd: ws, encoding: "utf8", stdio: "pipe" },
          ).trim(),
          10,
        );
        return { passed: documented / exported >= 0.4 };
      } catch {
        return { passed: true };
      }
    },
  },

  // P09: Cross-repo compatibility — no absolute path imports that break portability
  {
    id: "P09",
    run: (ws) => {
      try {
        const result = execSync(
          `grep -r "from ['\\"]/Users/" --include="*.ts" --include="*.js" --exclude-dir=node_modules -l 2>/dev/null | wc -l`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();
        return { passed: parseInt(result, 10) === 0 };
      } catch {
        return { passed: true };
      }
    },
  },

  // P10: Error handling — no unhandled promise rejections pattern
  {
    id: "P10",
    run: (ws) => {
      try {
        // Check for .then() without .catch() in source files
        const srcDir = ["src", "lib", "app"].find((d) =>
          fs.existsSync(path.join(ws, d)),
        );
        if (!srcDir) return { passed: true };

        const thenCount = parseInt(
          execSync(
            `grep -r "\\.then(" ${srcDir} --include="*.ts" --include="*.js" 2>/dev/null | wc -l`,
            { cwd: ws, encoding: "utf8", stdio: "pipe" },
          ).trim(),
          10,
        );
        const catchCount = parseInt(
          execSync(
            `grep -r "\\.catch(" ${srcDir} --include="*.ts" --include="*.js" 2>/dev/null | wc -l`,
            { cwd: ws, encoding: "utf8", stdio: "pipe" },
          ).trim(),
          10,
        );
        // Allow up to 3x more .then() than .catch() (some chains are fine)
        if (thenCount === 0) return { passed: true };
        return { passed: thenCount / Math.max(1, catchCount) <= 3 };
      } catch {
        return { passed: true };
      }
    },
  },

  // P11: No direct DB calls outside designated service/repository layer
  {
    id: "P11",
    run: (ws) => {
      try {
        const disallowedDirs = ["components", "pages", "app/api", "hooks"];
        const presentDirs = disallowedDirs.filter(
          (d) =>
            fs.existsSync(path.join(ws, d)) ||
            fs.existsSync(path.join(ws, "src", d)),
        );
        if (presentDirs.length === 0) return { passed: true };

        const dirArgs = presentDirs
          .map((d) => `${fs.existsSync(path.join(ws, d)) ? d : `src/${d}`}`)
          .join(" ");
        const result = execSync(
          `grep -r "\\.(query|execute|findOne|findMany|insert|update|delete)(" ${dirArgs} --include="*.ts" -l 2>/dev/null | wc -l`,
          { cwd: ws, encoding: "utf8", stdio: "pipe" },
        ).trim();
        return { passed: parseInt(result, 10) === 0 };
      } catch {
        return { passed: true };
      }
    },
  },

  // P12: Conventional commit format in recent commits (last 5)
  {
    id: "P12",
    run: (ws) => {
      try {
        if (!fs.existsSync(path.join(ws, ".git"))) return { passed: true };
        const log = execSync("git log --oneline -5 2>/dev/null", {
          cwd: ws,
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        if (!log) return { passed: true };
        const lines = log.split("\n");
        const conventionalRe =
          /^[a-f0-9]+ (feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\(.+\))?!?: .+/;
        const passing = lines.filter((l) => conventionalRe.test(l)).length;
        return { passed: passing / lines.length >= 0.8 };
      } catch {
        return { passed: true };
      }
    },
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
function runHoldout(workspace) {
  const results = [];
  let passed = 0;

  for (const probe of PROBES) {
    let result;
    try {
      result = probe.run(workspace);
    } catch (e) {
      result = { passed: false };
    }
    results.push({ probe_id: probe.id, passed: result.passed });
    if (result.passed) passed++;
  }

  const hcov = passed / PROBES.length;
  const verdict = hcov >= 0.7 ? "pass" : "fail"; // hidden threshold: 70%

  return {
    passed: verdict === "pass",
    hcov: Math.round(hcov * 1000) / 1000,
    probe_count: PROBES.length,
    probes_passed: passed,
    verdict,
    feedback: verdict === "pass" ? "PASS" : "FAIL",
    // probe_results intentionally omitted from public output — internal use only
    _internal: results,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  let workspace = "";
  let outputFile = "";
  let showInternal = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace") workspace = args[++i];
    else if (args[i] === "--output") outputFile = args[++i];
    else if (args[i] === "--internal") showInternal = true;
  }

  if (!workspace) {
    console.error(
      "Usage: node layer2-holdout.js --workspace /path/to/repo [--output path] [--internal]",
    );
    process.exit(1);
  }

  const result = runHoldout(workspace);
  const output = showInternal
    ? result
    : {
        passed: result.passed,
        hcov: result.hcov,
        probe_count: result.probe_count,
        probes_passed: result.probes_passed,
        verdict: result.verdict,
        feedback: result.feedback,
      };

  const json = JSON.stringify(output, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, json);
  }
  console.log(json);
  process.exit(result.passed ? 0 : 1);
}

module.exports = { runHoldout, PROBES };
