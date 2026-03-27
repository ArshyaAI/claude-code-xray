/**
 * cli.ts — Factory CLI argument parser
 *
 * Parses command-line arguments and delegates to the appropriate runner.
 * Called by: skills/factory/factory.sh → node dist/orchestrator/cli.js
 */

import { runShadowLeague, type ShadowRunOptions } from "./shadow.js";

// ─── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  command: string;
  options: Partial<ShadowRunOptions>;
} {
  const command = argv[0] ?? "help";
  const options: Partial<ShadowRunOptions> = {};

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--repo":
        options.repo = argv[++i] ?? ".";
        break;
      case "--tasks":
        options.tasks = parseInt(argv[++i] ?? "8", 10);
        break;
      case "--crews":
        options.crews = parseInt(argv[++i] ?? "2", 10);
        break;
      case "--budget":
        options.budget = parseFloat(argv[++i] ?? "50");
        break;
      case "--parallel":
        options.parallel = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--keep-worktrees":
        options.keepWorktrees = true;
        break;
      case "--seed":
        options.seed = parseInt(argv[++i] ?? "0", 10);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
    i++;
  }

  return { command, options };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "run": {
      const result = runShadowLeague(options);

      // Print leaderboard
      console.log("\n=== SHADOW LEAGUE RESULTS ===\n");
      console.log(`Run:      ${result.run_id}`);
      console.log(`Status:   ${result.status}`);
      console.log(`Cost:     $${result.total_cost_usd}`);
      console.log(`Duration: ${result.total_duration_sec}s`);
      console.log("");

      // Crew rankings
      const sorted = [...result.crews].sort(
        (a, b) => b.aggregate_utility - a.aggregate_utility,
      );
      console.log("Crew Rankings:");
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        if (!c) continue;
        const medal = i === 0 ? ">>>" : "   ";
        console.log(
          `  ${medal} ${c.label.padEnd(12)} ${c.genotype_id.padEnd(10)} U=${c.aggregate_utility}`,
        );
      }
      console.log("");

      // Promotion decision
      if (result.promotion.should_promote) {
        console.log(
          `PROMOTED: ${result.promotion.winner_label} is the new champion!`,
        );
      } else {
        console.log(`No promotion. ${result.promotion.reason}`);
      }

      if (result.promotion.sign_test) {
        console.log(
          `Sign test: p=${result.promotion.sign_test.p_value} (n=${result.promotion.sign_test.n_tasks})`,
        );
      }

      console.log("\n=============================\n");

      // Exit with appropriate code
      process.exit(result.status === "failed" ? 1 : 0);
      break;
    }

    case "variance-check": {
      // Variance check: run same genotype twice
      const vcOptions: Partial<ShadowRunOptions> = {
        ...options,
        crews: 2, // Force 2 crews (both champion — no mutant)
      };
      console.log("Variance check mode: running champion vs champion");
      console.log(
        "(This measures intra-genotype noise from LLM non-determinism)\n",
      );

      const result = runShadowLeague(vcOptions);

      if (result.crews.length >= 2) {
        const crew1 = result.crews[0];
        const crew2 = result.crews[1];
        if (crew1 && crew2) {
          const utils1 = crew1.scores.map((s) => s.utility);
          const utils2 = crew2.scores.map((s) => s.utility);

          // Compute variance of differences
          const diffs: number[] = [];
          const len = Math.min(utils1.length, utils2.length);
          for (let i = 0; i < len; i++) {
            const u1 = utils1[i];
            const u2 = utils2[i];
            if (u1 !== undefined && u2 !== undefined) {
              diffs.push(u1 - u2);
            }
          }

          const meanDiff =
            diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
          const variance =
            diffs.reduce((a, d) => a + Math.pow(d - meanDiff, 2), 0) /
            Math.max(1, diffs.length - 1);
          const meanU =
            [...utils1, ...utils2].reduce((a, b) => a + b, 0) /
            Math.max(1, utils1.length + utils2.length);
          const cv = meanU > 0 ? Math.sqrt(variance) / meanU : 0;

          console.log("\n=== VARIANCE CHECK RESULTS ===\n");
          console.log(`Tasks:            ${len}`);
          console.log(`sigma²_intra:     ${variance.toFixed(6)}`);
          console.log(`mean(U):          ${meanU.toFixed(4)}`);
          console.log(`CV:               ${cv.toFixed(4)}`);
          console.log("");

          if (cv < 0.1) {
            console.log(
              "PASS: Signal likely exceeds noise. Proceed with evolution.",
            );
          } else if (cv < 0.25) {
            console.log(
              "CAUTION: Moderate noise. Increase N to 16+ tasks per run.",
            );
          } else {
            console.log(
              "FAIL: High noise. Investigate: temperature=0, reduce prompt variance, or N=30+.",
            );
          }
          console.log("\n==============================\n");
        }
      }

      process.exit(0);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main();
