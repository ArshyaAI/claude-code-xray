/**
 * context-generator.ts — Generates CLAUDE.md and .claude/rules/ structure
 *
 * Generates fixes for:
 *   - Missing project-level CLAUDE.md
 *   - Missing .claude/rules/ directory structure
 */

import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { Fix, XRayResult } from "../scan/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectProjectName(repoRoot: string): string {
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.name === "string" && pkg.name.length > 0) {
        return pkg.name;
      }
    } catch {
      // fall through
    }
  }
  // Fallback to directory name
  return basename(repoRoot);
}

function detectStack(repoRoot: string): string[] {
  const stack: string[] = [];
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (deps["next"]) stack.push("Next.js");
      if (deps["react"]) stack.push("React");
      if (deps["typescript"]) stack.push("TypeScript");
      if (deps["express"]) stack.push("Express");
      if (deps["fastify"]) stack.push("Fastify");
      if (deps["vue"]) stack.push("Vue");
      if (deps["svelte"]) stack.push("Svelte");
    } catch {
      // fall through
    }
  }
  if (existsSync(join(repoRoot, "Cargo.toml"))) stack.push("Rust");
  if (existsSync(join(repoRoot, "go.mod"))) stack.push("Go");
  if (
    existsSync(join(repoRoot, "requirements.txt")) ||
    existsSync(join(repoRoot, "pyproject.toml"))
  )
    stack.push("Python");
  return stack;
}

// ─── CLAUDE.md template ─────────────────────────────────────────────────────

function generateClaudeMdContent(repoRoot: string): string {
  const name = detectProjectName(repoRoot);
  const stack = detectStack(repoRoot);
  const stackLine =
    stack.length > 0 ? `\n- **Stack**: ${stack.join(", ")}` : "";

  return `# ${name}
${stackLine}

## Commands

- Build: \`# TODO: add build command\`
- Test: \`# TODO: add test command\`
- Lint: \`# TODO: add lint command\`

## Architecture

- \`src/\` — Source code
- \`# TODO: describe your project structure\`

## Rules

- Run tests after code changes
- Follow existing code style and patterns
- Architecture decisions require explicit approval
`;
}

// ─── Fix: Generate CLAUDE.md ────────────────────────────────────────────────

function fixMissingClaudeMd(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const capDim = result.dimensions["capability"];
  if (!capDim) return undefined;

  const check = capDim.checks.find((c) => c.name === "Project CLAUDE.md");
  if (!check || check.passed) return undefined;

  const targetFile = join(repoRoot, "CLAUDE.md");
  // Double-check the file truly doesn't exist
  if (existsSync(targetFile)) return undefined;

  const content = generateClaudeMdContent(repoRoot);

  return {
    id: "context/claude-md",
    dimension: "capability",
    description:
      "Generate a starter CLAUDE.md with project name, stack detection, and basic sections",
    diff: content,
    impact_estimate: 10,
    security_relevant: false,
    why_safe:
      "Creates a new CLAUDE.md file at the project root. Does not modify any existing files. The template contains only TODO placeholders and detected project metadata.",
    target_file: targetFile,
  };
}

// ─── Fix: Create .claude/rules/ directory ───────────────────────────────────

function fixMissingRulesDir(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const capDim = result.dimensions["capability"];
  if (!capDim) return undefined;

  const rulesDir = join(repoRoot, ".claude", "rules");
  if (existsSync(rulesDir)) return undefined;

  // Create a minimal README in the rules directory
  const targetFile = join(rulesDir, "README.md");
  const content = `# Claude Code Rules

Place \`.md\` files in this directory to provide scope-specific instructions.
Each file is loaded as context when Claude Code operates on matching paths.

Example: \`security.md\` with rules for files matching \`**/auth/**\`.
`;

  return {
    id: "context/rules-dir",
    dimension: "capability",
    description:
      "Create .claude/rules/ directory with a README explaining its purpose",
    diff: content,
    impact_estimate: 3,
    security_relevant: false,
    why_safe:
      "Creates a new directory and a single README.md file. No existing files are modified. The rules directory is a standard Claude Code convention for scoped instructions.",
    target_file: targetFile,
  };
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

export function generateContextFixes(
  result: XRayResult,
  repoRoot: string,
): Fix[] {
  const fixes: (Fix | undefined)[] = [
    fixMissingClaudeMd(result, repoRoot),
    fixMissingRulesDir(result, repoRoot),
  ];
  return fixes.filter((f): f is Fix => f !== undefined);
}
