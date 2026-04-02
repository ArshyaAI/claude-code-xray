import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SettingsLocations {
  user: string;
  projectShared: string;
  projectLocal: string;
  claudeJson: string;
}

export function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function getHome(): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"];
  if (!home) {
    throw new Error("HOME or USERPROFILE environment variable is required");
  }
  return home;
}

export function getSettingsLocations(repoRoot: string): SettingsLocations {
  const home = getHome();
  return {
    user: join(home, ".claude", "settings.json"),
    projectShared: join(repoRoot, ".claude", "settings.json"),
    projectLocal: join(repoRoot, ".claude", "settings.local.json"),
    claudeJson: join(home, ".claude.json"),
  };
}
