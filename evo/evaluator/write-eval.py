#!/usr/bin/env python3
"""
write-eval.py — DeFactory Evaluation Result Persister

IMMUTABLE: This file is read-only from agents (enforced by policy.yml).
Changes require board approval and a new policy.yml freeze cycle.

Reads a score.json and writes the result to evo.db (evaluations table).
On rejection, also writes to the cemetery table.

Usage:
  python3 write-eval.py --score-json /path/to/score.json [--db /path/to/evo.db]
  python3 write-eval.py --score-json /path/to/score.json --cemetery-reason "G_build failed"
"""

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone


EVO_DB_DEFAULT = os.path.expanduser("~/.factory/evo.db")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_evaluation(conn: sqlite3.Connection, score: dict) -> int:
    """Insert evaluation record. Returns rowid."""
    scores_json = json.dumps(score["scores"]) if score.get("scores") else "{}"
    cur = conn.execute(
        """
        INSERT INTO evaluations
          (genotype_id, task_id, stage, scores, utility, gates_passed,
           cost_usd, duration_sec, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            score["genotype_id"],
            score["task_id"],
            score.get("stage", "search"),
            scores_json,
            score.get("utility", 0.0),
            1 if score.get("gates_passed", False) else 0,
            score.get("cost_usd", 0.0),
            score.get("duration_sec", 0),
            now_iso(),
        ),
    )
    return cur.lastrowid


def write_cemetery(conn: sqlite3.Connection, score: dict, cause: str) -> int:
    """Insert cemetery record for rejected genotypes. Returns rowid."""
    scores_json = json.dumps(score.get("scores") or {})
    lessons = score.get("reject_reason") or cause
    cur = conn.execute(
        """
        INSERT INTO cemetery
          (genotype_id, cause, stage, scores, lessons, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            score["genotype_id"],
            cause,
            score.get("stage", "search"),
            scores_json,
            lessons,
            now_iso(),
        ),
    )
    return cur.lastrowid


def main():
    parser = argparse.ArgumentParser(description="Persist evaluation results to evo.db")
    parser.add_argument("--score-json", required=True, help="Path to score.json")
    parser.add_argument(
        "--db", default=EVO_DB_DEFAULT, help=f"Path to evo.db (default: {EVO_DB_DEFAULT})"
    )
    parser.add_argument(
        "--cemetery-reason",
        default=None,
        help="If set, also write to cemetery with this rejection cause",
    )
    args = parser.parse_args()

    # Load score.json
    if not os.path.exists(args.score_json):
        print(f"ERROR: score.json not found: {args.score_json}", file=sys.stderr)
        sys.exit(1)

    with open(args.score_json) as f:
        score = json.load(f)

    # Validate required fields
    required = ["genotype_id", "task_id"]
    missing = [k for k in required if not score.get(k)]
    if missing:
        print(f"ERROR: score.json missing required fields: {missing}", file=sys.stderr)
        sys.exit(1)

    # Validate genotype_id exists in DB
    if not os.path.exists(args.db):
        print(f"ERROR: evo.db not found: {args.db}", file=sys.stderr)
        print("Run: ./evo/init-evo-db.sh to initialize.", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    try:
        # Check genotype exists
        row = conn.execute(
            "SELECT id FROM genotypes WHERE id = ?", (score["genotype_id"],)
        ).fetchone()
        if row is None:
            print(
                f"ERROR: genotype_id '{score['genotype_id']}' not found in genotypes table.",
                file=sys.stderr,
            )
            print("Run init-evo-db.sh or ensure the genotype was registered first.", file=sys.stderr)
            sys.exit(1)

        # Write evaluation record
        eval_rowid = write_evaluation(conn, score)
        print(f"Inserted evaluation rowid={eval_rowid} for {score['genotype_id']} / {score['task_id']}")

        # Optionally write to cemetery
        if args.cemetery_reason:
            cem_rowid = write_cemetery(conn, score, args.cemetery_reason)
            print(f"Inserted cemetery rowid={cem_rowid}: {args.cemetery_reason}")

        conn.commit()

        # Summary output
        result = {
            "eval_rowid": eval_rowid,
            "genotype_id": score["genotype_id"],
            "task_id": score["task_id"],
            "stage": score.get("stage", "search"),
            "utility": score.get("utility", 0.0),
            "verdict": score.get("verdict", "rejected" if not score.get("gates_passed") else "frontier"),
            "cemetery_written": args.cemetery_reason is not None,
        }
        print(json.dumps(result, indent=2))

    except sqlite3.Error as e:
        conn.rollback()
        print(f"ERROR: DB write failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
