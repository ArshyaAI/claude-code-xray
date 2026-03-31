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

const args = process.argv.slice(2);
const command = args[0] ?? "scan";
const flags = new Set(args.slice(1));

switch (command) {
  case "scan":
  case undefined: {
    const result = runXRay(".");
    if (flags.has("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderResult(result));
    }
    break;
  }

  case "fix": {
    const dryRun = !flags.has("--apply");
    console.log(
      dryRun
        ? "Dry run (showing fixes without applying). Use --apply to execute.\n"
        : "Applying fixes...\n",
    );
    // TODO: integrate fix module
    const result = runXRay(".");
    const fixable = Object.values(result.dimensions)
      .flatMap((d) => d.checks)
      .filter((c) => !c.passed && c.fix_available);

    if (fixable.length === 0) {
      console.log("No fixes needed. Your setup is solid.");
    } else {
      console.log(`${fixable.length} fixes available:\n`);
      for (const check of fixable) {
        console.log(`  - ${check.name}`);
        if (check.detail) console.log(`    ${check.detail}`);
      }
      if (dryRun) {
        console.log("\nRun with --apply to execute these fixes.");
      }
    }
    break;
  }

  case "badge": {
    const result = runXRay(".");
    const score = result.overall_score;
    const color = score >= 71 ? "brightgreen" : score >= 41 ? "yellow" : "red";
    const encoded = encodeURIComponent(`${score}/100`);
    const url = `https://img.shields.io/badge/xray-${encoded}-${color}`;

    if (flags.has("--svg")) {
      console.log(`Badge URL: ${url}`);
    } else {
      console.log(`![X-Ray: ${score}](${url})`);
    }
    console.log("\nAdd this to your README to show your setup score.");
    break;
  }

  case "history": {
    // TODO: integrate history module
    console.log("History tracking not yet implemented. Coming in Phase 1.");
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
  --help    Show this help
`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error("Run 'npx claude-code-xray --help' for usage.");
    process.exit(1);
}
