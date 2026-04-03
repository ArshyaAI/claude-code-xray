#!/usr/bin/env node
/**
 * cli.ts — Claude Code X-Ray CLI entry point
 *
 * Usage:
 *   npx claude-code-xray           # scan current directory
 *   npx claude-code-xray fix       # show fixes (dry-run by default)
 *   npx claude-code-xray fix --apply  # apply fixes
 *   npx claude-code-xray badge     # output badge markdown
 *   npx claude-code-xray history   # show score history
 *   npx claude-code-xray ci        # CI gate (exit 1 on failure)
 *   npx claude-code-xray diff      # compare against last scan
 *   npx claude-code-xray --json    # output raw JSON
 */

import { runXRay } from "./index.js";
import { renderResult } from "./render.js";
import { animateScan, animateFix, isTTY } from "./animate.js";
import { generateFixes, applyFix } from "../fix/index.js";
import { badgeMarkdown, badgeSvg } from "../viral/badge.js";
import { appendHistory, readHistory, renderHistory } from "../viral/history.js";
import { computeDiff, renderDiff } from "./diff.js";
import { consolidateMemory } from "../fix/memory-consolidator.js";
import { generateGuardian } from "../guardian/generate.js";
import { renderGuardian, STAGE_LABELS } from "../guardian/sprites.js";
import type { CheckResult } from "./types.js";

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--")));
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const command = positional[0] ?? "scan";

/** Extract a numeric flag value: --flag N or --flag=N */
function getFlagValue(name: string): number | undefined {
  const eqForm = rawArgs.find((a) => a.startsWith(`${name}=`));
  if (eqForm) {
    const v = Number(eqForm.split("=")[1]);
    return Number.isFinite(v) ? v : undefined;
  }
  const idx = rawArgs.indexOf(name);
  if (idx >= 0 && idx + 1 < rawArgs.length) {
    const v = Number(rawArgs[idx + 1]);
    return Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

/** Flatten all checks from an XRayResult */
function flattenChecks(result: {
  dimensions: Record<string, { checks: CheckResult[] }>;
}): CheckResult[] {
  return Object.values(result.dimensions).flatMap((d) => d.checks);
}

/** Build dimensions summary for history entries */
function dimsSummary(
  result: ReturnType<typeof runXRay>,
): Record<string, { name: string; score: number }> {
  const out: Record<string, { name: string; score: number }> = {};
  for (const [key, dim] of Object.entries(result.dimensions)) {
    out[key] = { name: dim.name, score: dim.score };
  }
  return out;
}

async function main(): Promise<void> {
  const useAnimation =
    isTTY() && !flags.has("--json") && !flags.has("--no-color");

  switch (command) {
    case "scan":
    case undefined: {
      const result = runXRay(".");

      // Track history with checks for future diff
      appendHistory({
        timestamp: result.timestamp,
        action: "scan",
        repo: result.repo,
        overall_score: result.overall_score,
        dimensions_scored: result.dimensions_scored,
        dimensions: dimsSummary(result),
        checks: flattenChecks(result),
      });

      if (flags.has("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else if (useAnimation) {
        await animateScan(result);
      } else {
        console.log(renderResult(result));
      }
      break;
    }

    case "ci": {
      const minScore = getFlagValue("--min-score") ?? 0;
      const minSafety = getFlagValue("--min-safety") ?? 0;
      const result = runXRay(".");

      const safetyDim = result.dimensions["safety"];
      const safetyScore = safetyDim ? safetyDim.score : 0;

      const overallPass = minScore === 0 || result.overall_score >= minScore;
      const safetyPass = minSafety === 0 || safetyScore >= minSafety;
      const pass = overallPass && safetyPass;

      // Track history
      appendHistory({
        timestamp: result.timestamp,
        action: "ci",
        repo: result.repo,
        overall_score: result.overall_score,
        dimensions_scored: result.dimensions_scored,
        dimensions: dimsSummary(result),
        checks: flattenChecks(result),
      });

      if (flags.has("--json")) {
        const output = {
          score: result.overall_score,
          pass,
          min_score: minScore,
          min_safety: minSafety,
          dimensions_scored: result.dimensions_scored,
          dimensions: Object.fromEntries(
            Object.entries(result.dimensions).map(([k, d]) => [
              k,
              {
                score: d.score,
                checks_passed: d.checks.filter((c) => c.passed).length,
                checks_total: d.checks.length,
              },
            ]),
          ),
          blocking: [] as string[],
        };
        if (!overallPass)
          output.blocking.push(
            `overall score ${result.overall_score} < ${minScore}`,
          );
        if (!safetyPass)
          output.blocking.push(`safety score ${safetyScore} < ${minSafety}`);
        console.log(JSON.stringify(output, null, 2));
      } else {
        // Compact CI output
        const status = pass ? "PASS" : "FAIL";
        const delta = !overallPass
          ? `, delta: ${result.overall_score - minScore}`
          : "";
        const threshold = minScore > 0 ? ` (min: ${minScore}${delta})` : "";
        console.log(
          `X-Ray: ${result.overall_score}/100 (${result.dimensions_scored}/4 dims) \u2014 ${status}${threshold}`,
        );

        // Dimension line
        const dimOrder = ["safety", "capability", "automation", "efficiency"];
        const dimLabels = {
          safety: "Safety",
          capability: "Capability",
          automation: "Automation",
          efficiency: "Efficiency",
        };
        const dimParts: string[] = [];
        for (const key of dimOrder) {
          const dim = result.dimensions[key];
          if (!dim || dim.checks.length === 0) continue;
          const label = dimLabels[key as keyof typeof dimLabels];
          const alert = key === "safety" && !safetyPass ? " [!]" : "";
          dimParts.push(`${label}: ${dim.score}${alert}`);
        }
        console.log(`  ${dimParts.join("  ")}`);

        // Blocking reasons
        if (!pass) {
          const reasons: string[] = [];
          if (!overallPass)
            reasons.push(`overall score ${result.overall_score} < ${minScore}`);
          if (!safetyPass)
            reasons.push(`safety score ${safetyScore} < ${minSafety}`);
          console.log(`  Blocking: ${reasons.join(", ")}`);
        }
      }

      if (!pass) process.exit(1);
      break;
    }

    case "diff": {
      const result = runXRay(".");
      const entries = readHistory();

      if (entries.length === 0) {
        console.log(
          "No previous scan found. Run `npx claude-code-xray` first.",
        );
        break;
      }

      const previous = entries[entries.length - 1]!;
      const diff = computeDiff(result, previous, previous.checks);

      if (flags.has("--json")) {
        console.log(JSON.stringify(diff, null, 2));
      } else {
        console.log(renderDiff(diff));
      }
      break;
    }

    case "fix": {
      const dryRun = !flags.has("--apply");
      const result = runXRay(".");
      const fixes = generateFixes(result, ".");

      if (fixes.length === 0) {
        console.log("No fixes needed. Your setup is solid.");
        break;
      }

      if (dryRun) {
        console.log(`${fixes.length} fixes available (dry run):\n`);
        for (const fix of fixes) {
          applyFix(fix, true);
          console.log("");
        }
        console.log("Run with --apply to execute these fixes.");
      } else {
        // Apply fixes
        let applied = 0;
        for (const fix of fixes) {
          applyFix(fix, false);
          applied++;
        }

        // Re-scan
        const after = runXRay(".");
        const delta = after.overall_score - result.overall_score;

        if (useAnimation) {
          await animateFix(result, after, fixes, applied);
        } else {
          console.log(
            `\n${result.overall_score} \u2192 ${after.overall_score} ${delta > 0 ? `(+${delta})` : ""}\n`,
          );
          console.log(
            `Applied ${applied} fixes. Backups saved to each file's directory.`,
          );
        }

        appendHistory({
          timestamp: new Date().toISOString(),
          action: "fix",
          repo: result.repo,
          overall_score: after.overall_score,
          dimensions_scored: after.dimensions_scored,
          fixes_applied: fixes.map((f) => f.id),
          score_delta: delta,
          dimensions: dimsSummary(after),
          checks: flattenChecks(after),
        });
      }
      break;
    }

    case "badge": {
      const result = runXRay(".");
      if (flags.has("--svg")) {
        console.log(badgeSvg(result.overall_score));
      } else {
        console.log(badgeMarkdown(result.overall_score));
        console.log("\nAdd this to your README to show your setup score.");
      }
      break;
    }

    case "history": {
      const entries = readHistory();
      console.log(renderHistory(entries));
      break;
    }

    case "guardian": {
      const result = runXRay(".");
      const guardian = generateGuardian(
        result.repo,
        result.overall_score,
        result.archetype,
      );
      const stageLabel = STAGE_LABELS[guardian.stage];
      const shinyTag = guardian.shiny ? " *SHINY*" : "";
      const sprite = renderGuardian(guardian, 0);

      console.log("");
      console.log(
        `  Guardian: ${guardian.species.charAt(0).toUpperCase() + guardian.species.slice(1)} [${stageLabel}]${shinyTag}`,
      );
      console.log(`  Score: ${result.overall_score}/100`);
      console.log(`  Archetype: ${result.archetype}`);
      console.log("");
      for (const line of sprite) {
        console.log(`  ${line}`);
      }
      console.log("");
      console.log(
        `  Stage thresholds: <30 EXPOSED | <60 GUARDED | <80 FORTIFIED | 80+ SENTINEL`,
      );
      console.log("");
      break;
    }

    case "--help":
    case "help": {
      console.log(`
Claude Code X-Ray \u2014 See inside your Claude Code setup

Usage:
  npx claude-code-xray              Scan current directory
  npx claude-code-xray fix          Show available fixes (dry-run)
  npx claude-code-xray fix --apply  Apply fixes
  npx claude-code-xray consolidate  Preview MEMORY.md consolidation
  npx claude-code-xray consolidate --apply  Write consolidated MEMORY.md
  npx claude-code-xray badge        Generate README badge
  npx claude-code-xray history      Show score history
  npx claude-code-xray ci           CI gate (exit 1 on failure)
  npx claude-code-xray diff         Compare against last scan
  npx claude-code-xray guardian     Show your X-Ray Guardian
  npx claude-code-xray --json       Output raw JSON

CI Options:
  --min-score N   Minimum overall score to pass (default: 0)
  --min-safety N  Minimum safety dimension score to pass (default: 0)

Options:
  --json    Output scan/ci/diff results as JSON
  --apply   Apply fixes or consolidation (default: dry-run)
  --svg     Output SVG badge instead of markdown
  --help    Show this help
`);
      break;
    }

    case "consolidate": {
      const dryRun = !flags.has("--apply");
      const result = consolidateMemory(".", dryRun);

      if (result.before === 0) {
        console.log(result.diff);
        break;
      }

      console.log(
        dryRun
          ? `[DRY RUN] Memory consolidation preview:\n`
          : `Memory consolidated:\n`,
      );
      console.log(`  Before: ${result.before} lines`);
      console.log(`  After:  ${result.after} lines`);
      console.log(`  Delta:  ${result.after - result.before} lines\n`);
      console.log(result.diff);

      if (dryRun && result.before !== result.after) {
        console.log("\nRun with --apply to write changes.");
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'npx claude-code-xray --help' for usage.");
      process.exit(1);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n[xray] Error: ${msg}`);
  process.exit(1);
});
