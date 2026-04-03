/**
 * phase2-cli.ts — Phase 2 commands (experiment, export, adopt)
 *
 * Separate entry point for Phase 2 commands. Will be merged into the
 * main cli.ts during integration with Phase 1 agent's work.
 *
 * Usage:
 *   node dist/phase2-cli.js experiment [--fix <id>]
 *   node dist/phase2-cli.js export [--output <file>]
 *   node dist/phase2-cli.js adopt <file.json> [--apply]
 */

import { writeFileSync } from "node:fs";
import {
  runExperiment,
  readExperimentHistory,
  renderExperimentResults,
} from "./evolution/experiment.js";
import { exportConfig, serializeExport } from "./viral/export-v2.js";
import {
  previewAdopt,
  adoptConfig,
  renderAdoptPreview,
} from "./viral/adopt-v2.js";

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "experiment":
      handleExperiment(args.slice(1));
      break;
    case "export":
      handleExport(args.slice(1));
      break;
    case "adopt":
      handleAdopt(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      if (command) {
        console.error(`Unknown command: ${command}`);
      }
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

function handleExperiment(args: string[]): void {
  const fixIdx = args.indexOf("--fix");
  const fixId = fixIdx >= 0 ? args[fixIdx + 1] : undefined;
  const showHistory = args.includes("--history");

  if (showHistory) {
    const history = readExperimentHistory();
    console.log(renderExperimentResults(history));
    return;
  }

  console.log("Running experiment...\n");
  const results = runExperiment(".", fixId);
  console.log(renderExperimentResults(results));
}

function handleExport(args: string[]): void {
  const outputIdx = args.indexOf("--output");
  const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

  console.log("Scanning and exporting...\n");
  const exported = exportConfig(".");
  const json = serializeExport(exported);

  if (outputFile) {
    writeFileSync(outputFile, json, "utf-8");
    console.log(`Exported to: ${outputFile}`);
  } else {
    console.log(json);
  }
}

function handleAdopt(args: string[]): void {
  const filePath = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");

  if (!filePath) {
    console.error("Usage: adopt <file.json> [--apply]");
    process.exit(1);
  }

  if (!apply) {
    // Dry-run: preview only
    const { diff, errors } = previewAdopt(filePath);
    console.log(renderAdoptPreview(diff, errors));
    if (errors.length > 0) {
      process.exit(1);
    }
    return;
  }

  // Live apply
  console.log("Adopting config...\n");
  const { applied, errors } = adoptConfig(filePath, ".", false);

  if (errors.length > 0) {
    console.error("Validation errors:");
    for (const e of errors) {
      console.error(`  ${e.field}: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`\nApplied ${applied} fix(es) from ${filePath}`);
}

function printHelp(): void {
  console.log(`
Claude Code X-Ray — Phase 2 Commands

Usage:
  xray experiment [--fix <id>]    Run controlled before/after experiments
  xray experiment --history       Show experiment history
  xray export [--output <file>]   Export shareable config
  xray adopt <file.json>          Preview what an import would change
  xray adopt <file.json> --apply  Apply fixes from a shared config

Options:
  --help, -h                      Show this help
`);
}

main();
