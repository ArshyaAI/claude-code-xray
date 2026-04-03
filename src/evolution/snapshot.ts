/**
 * evolution/snapshot.ts — Backup/restore settings files for experiments
 *
 * Takes a snapshot of all Claude Code settings files before applying a fix,
 * then restores them after measurement. Keeps experiment isolation clean.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { getSettingsLocations } from "../scan/utils.js";

const XRAY_DIR = join(process.env.HOME ?? "/tmp", ".xray");
const EXPERIMENTS_DIR = join(XRAY_DIR, "experiments");

export interface Snapshot {
  id: string;
  files: { path: string; content: string | null }[];
  created_at: string;
}

/**
 * Take a snapshot of all settings files for the given repo.
 * Returns a Snapshot that can be passed to restoreSnapshot().
 */
export function takeSnapshot(repoRoot: string, snapshotId: string): Snapshot {
  const locs = getSettingsLocations(repoRoot);
  const paths = [
    locs.user,
    locs.projectShared,
    locs.projectLocal,
    locs.claudeJson,
  ];

  const files = paths.map((p) => ({
    path: p,
    content: existsSync(p) ? readFileSync(p, "utf-8") : null,
  }));

  const snapshot: Snapshot = {
    id: snapshotId,
    files,
    created_at: new Date().toISOString(),
  };

  // Persist to disk for crash recovery
  const snapshotDir = join(EXPERIMENTS_DIR, snapshotId);
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(
    join(snapshotDir, "snapshot.json"),
    JSON.stringify(snapshot, null, 2),
    "utf-8",
  );

  return snapshot;
}

/**
 * Restore all settings files from a snapshot.
 * Files that didn't exist before the snapshot are deleted.
 */
export function restoreSnapshot(snapshot: Snapshot): void {
  for (const file of snapshot.files) {
    if (file.content === null) {
      // File didn't exist before — remove if it was created
      if (existsSync(file.path)) {
        rmSync(file.path);
      }
    } else {
      // Restore original content
      const dir = dirname(file.path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(file.path, file.content, "utf-8");
    }
  }
}

/**
 * Clean up persisted snapshot files.
 */
export function cleanupSnapshot(snapshotId: string): void {
  const snapshotDir = join(EXPERIMENTS_DIR, snapshotId);
  if (existsSync(snapshotDir)) {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

/**
 * Get the experiments directory path.
 */
export function getExperimentsDir(): string {
  return EXPERIMENTS_DIR;
}
