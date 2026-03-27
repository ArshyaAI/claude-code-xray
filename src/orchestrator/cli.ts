/**
 * cli.ts — Factory CLI argument parser
 *
 * Parses command-line arguments and delegates to the appropriate runner.
 * Called by: skills/factory/factory.sh → node dist/orchestrator/cli.js
 */

import {
  runShadowLeague,
  type ShadowRunOptions,
  type ShadowRunResult,
  type CrewResult,
} from "./shadow.js";
import type { ParetoDimensions } from "../evaluator/score.js";
import { printLineage } from "./lineage.js";
import { showHistory } from "./history.js";
import {
  describeMutation,
  describeScoreComparison,
  oneLinerResult,
} from "./narrative.js";

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
      case "--full-pareto":
        options.fullPareto = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
    i++;
  }

  return { command, options };
}

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

// ─── Leaderboard ─────────────────────────────────────────────────────────────

function printLeaderboard(result: ShadowRunResult): void {
  const line = "─".repeat(60);

  console.log(`\n${c.bold}${c.cyan}${line}${c.reset}`);
  console.log(`${c.bold}  SHADOW LEAGUE RESULTS${c.reset}`);
  console.log(`${c.cyan}${line}${c.reset}\n`);

  // Run metadata
  const statusColor =
    result.status === "completed"
      ? c.green
      : result.status === "budget_exceeded"
        ? c.yellow
        : c.red;
  console.log(`  Run:      ${c.bold}${result.run_id}${c.reset}`);
  console.log(`  Status:   ${statusColor}${result.status}${c.reset}`);
  console.log(`  Cost:     $${result.total_cost_usd}`);
  console.log(`  Duration: ${formatDuration(result.total_duration_sec)}`);
  console.log("");

  // Crew rankings
  const sorted = [...result.crews].sort(
    (a, b) => b.aggregate_utility - a.aggregate_utility,
  );

  console.log(`  ${c.bold}CREW RANKINGS${c.reset}\n`);
  console.log(
    `  ${"#".padEnd(3)} ${"Crew".padEnd(14)} ${"Genotype".padEnd(10)} ${"U(p)".padEnd(8)} ${"C".padEnd(5)} ${"R".padEnd(5)} ${"H".padEnd(5)} ${"Q".padEnd(5)} ${"T".padEnd(5)} ${"K".padEnd(5)} ${"S".padEnd(5)}`,
  );
  console.log(`  ${c.dim}${"─".repeat(78)}${c.reset}`);

  // Pre-compute champion average scores for narrative comparisons
  const championCrew = result.crews.find((cr) => cr.label === "champion");
  const championAvgScores = championCrew
    ? computeAverageScores(championCrew)
    : null;

  for (let i = 0; i < sorted.length; i++) {
    const crew = sorted[i];
    if (!crew) continue;

    const rank =
      i === 0
        ? `${c.green}${c.bold}1st${c.reset}`
        : `${c.dim}${i + 1}${i === 1 ? "nd" : "th"}${c.reset}`;
    const labelColor = i === 0 ? c.green : c.dim;
    const avgScores = computeAverageScores(crew);

    const dims = avgScores
      ? `${f(avgScores.C)} ${f(avgScores.R)} ${f(avgScores.H)} ${f(avgScores.Q)} ${f(avgScores.T)} ${f(avgScores.K)} ${f(avgScores.S)}`
      : `${c.dim}  —     —     —     —     —     —     —${c.reset}`;

    console.log(
      `  ${rank.padEnd(3 + (i === 0 ? c.green.length + c.bold.length + c.reset.length : c.dim.length + c.reset.length))} ${labelColor}${crew.label.padEnd(14)}${c.reset} ${crew.genotype_id.padEnd(10)} ${c.bold}${crew.aggregate_utility.toFixed(4).padEnd(8)}${c.reset} ${dims}`,
    );

    // Mutation narrative for mutant crews
    if (crew.mutation_manifest) {
      console.log(
        `    ${c.dim}${describeMutation(crew.mutation_manifest)}${c.reset}`,
      );
      if (avgScores && championAvgScores) {
        const champU = championCrew?.aggregate_utility ?? 0;
        console.log(
          `    ${c.dim}${describeScoreComparison(avgScores, championAvgScores, crew.aggregate_utility, champU)}${c.reset}`,
        );
      }
    }
  }

  console.log("");

  // Promotion decision
  if (result.promotion.should_promote) {
    console.log(
      `  ${c.green}${c.bold}PROMOTED${c.reset} ${result.promotion.winner_label} is the new champion!`,
    );
  } else {
    console.log(
      `  ${c.yellow}No promotion.${c.reset} ${result.promotion.reason}`,
    );
  }

  if (result.promotion.sign_test) {
    const st = result.promotion.sign_test;
    const pColor = st.passed ? c.green : c.red;
    console.log(
      `  Sign test: ${pColor}p=${st.p_value}${c.reset} (n=${st.n_tasks})`,
    );
  }

  if (result.promotion.pareto_dominance) {
    const pd = result.promotion.pareto_dominance;
    const pdColor = pd.passed ? c.green : c.red;
    console.log(
      `  Pareto dominance: ${pdColor}${pd.passed ? "PASSED" : "FAILED"}${c.reset} (n=${pd.n_tasks})`,
    );
    const dimEntries = Object.entries(pd.dimension_results) as [
      string,
      { p_value: number; passed: boolean; n_wins: number; n_losses: number },
    ][];
    for (const [dim, dr] of dimEntries) {
      const dimColor = dr.passed ? c.green : c.red;
      console.log(
        `    ${dim}: ${dimColor}p=${dr.p_value}${c.reset} (wins=${dr.n_wins}, losses=${dr.n_losses})`,
      );
    }
  }

  // One-liner summary from narrative engine
  const bestMutant = result.crews.find(
    (cr) => cr.mutation_manifest !== undefined,
  );
  if (bestMutant?.mutation_manifest) {
    const mutationDesc = describeMutation(bestMutant.mutation_manifest);
    const pValue = result.promotion.sign_test?.p_value ?? null;
    console.log(
      `\n  ${c.magenta}${oneLinerResult(result.promotion.should_promote, mutationDesc, pValue)}${c.reset}`,
    );
  }

  console.log(`\n${c.cyan}${line}${c.reset}\n`);
}

function computeAverageScores(crew: CrewResult): ParetoDimensions | null {
  const validScores = crew.scores
    .filter((s) => s.scores !== null)
    .map((s) => s.scores as ParetoDimensions);
  if (validScores.length === 0) return null;

  const dims: (keyof ParetoDimensions)[] = ["C", "R", "H", "Q", "T", "K", "S"];
  const avg: Record<string, number> = {};
  for (const d of dims) {
    avg[d] = validScores.reduce((sum, s) => sum + s[d], 0) / validScores.length;
  }
  return avg as unknown as ParetoDimensions;
}

function f(v: number): string {
  return v.toFixed(2).padEnd(5);
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "run": {
      const result = await runShadowLeague(options);

      printLeaderboard(result);

      // Exit with appropriate code
      process.exit(result.status === "failed" ? 1 : 0);
      break;
    }

    case "variance-check": {
      // Variance check: run same genotype twice
      const vcOptions: Partial<ShadowRunOptions> = {
        ...options,
        crews: 2,
        varianceCheck: true, // Both crews use same champion genotype
      };
      console.log("Variance check mode: running champion vs champion");
      console.log(
        "(This measures intra-genotype noise from LLM non-determinism)\n",
      );

      const result = await runShadowLeague(vcOptions);

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

    case "lineage": {
      printLineage();
      process.exit(0);
      break;
    }

    case "history": {
      showHistory();
      process.exit(0);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main();
