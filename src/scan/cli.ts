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
 *   npx claude-code-xray --json    # output raw JSON
 */

import { runXRay } from "./index.js";
import { renderResult } from "./render.js";
import { generateFixes, applyFix } from "../fix/index.js";
import { badgeMarkdown, badgeSvg } from "../viral/badge.js";
import { appendHistory, readHistory, renderHistory } from "../viral/history.js";

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--")));
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const command = positional[0] ?? "scan";

try {
  switch (command) {
    case "scan":
    case undefined: {
      const result = runXRay(".");

      // Track history
      appendHistory({
        timestamp: result.timestamp,
        action: "scan",
        repo: result.repo,
        overall_score: result.overall_score,
        dimensions_scored: result.dimensions_scored,
      });

      if (flags.has("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderResult(result));
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

      console.log(
        dryRun
          ? `${fixes.length} fixes available (dry run):\n`
          : `Applying ${fixes.length} fixes...\n`,
      );

      let applied = 0;
      for (const fix of fixes) {
        applyFix(fix, dryRun);
        if (!dryRun) applied++;
        console.log("");
      }

      if (dryRun) {
        console.log("Run with --apply to execute these fixes.");
      } else {
        // Re-scan and show delta
        const after = runXRay(".");
        const delta = after.overall_score - result.overall_score;
        console.log(
          `\n${result.overall_score} → ${after.overall_score} ${delta > 0 ? `(+${delta})` : ""}\n`,
        );
        console.log(
          `Applied ${applied} fixes. Backups saved to each file's directory.`,
        );

        appendHistory({
          timestamp: new Date().toISOString(),
          action: "fix",
          repo: result.repo,
          overall_score: after.overall_score,
          dimensions_scored: after.dimensions_scored,
          fixes_applied: fixes.map((f) => f.id),
          score_delta: delta,
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

    case "--help":
    case "help": {
      console.log(`
Claude Code X-Ray — See inside your Claude Code setup

Usage:
  npx claude-code-xray           Scan current directory
  npx claude-code-xray fix       Show available fixes (dry-run)
  npx claude-code-xray fix --apply  Apply fixes
  npx claude-code-xray badge     Generate README badge
  npx claude-code-xray history   Show score history
  npx claude-code-xray --json    Output raw JSON

Options:
  --json    Output scan results as JSON
  --apply   Apply fixes (default: dry-run)
  --svg     Output SVG badge instead of markdown
  --help    Show this help
`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'npx claude-code-xray --help' for usage.");
      process.exit(1);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n[xray] Error: ${msg}`);
  process.exit(1);
}
