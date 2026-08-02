#!/usr/bin/env node
// scripts/check-size.mjs
//
// Size-budget gate for release artifacts. Reads scripts/size-budget.json,
// measures the configured paths (a file's byte size, or a directory's
// recursive total), and compares each against a recorded baseline with a
// percentage tolerance.
//
// Entries whose baseline is `null` are informational only: the measured
// size is printed with a "record this" note, but the run never fails on
// them. Once a baseline is filled in, exceeding
// baseline * (1 + tolerancePercent / 100) fails the run (exit 1).
//
// Runs under both `bun` and `node` (no dependencies). Paths in the budget
// file are repo-root-relative and are resolved from this script's own
// location, so it works regardless of the caller's working directory:
//
//   bun scripts/check-size.mjs
//   node scripts/check-size.mjs

import { readFile, stat, readdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const budgetPath = path.join(__dirname, "size-budget.json");

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "n/a";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

async function dirSizeBytes(dirPath) {
  let total = 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(entryPath);
    } else if (entry.isFile()) {
      const info = await stat(entryPath);
      total += info.size;
    }
    // symlinks and other special entries are skipped deliberately
  }
  return total;
}

async function measure(targetPath) {
  const absolute = path.join(repoRoot, targetPath);
  if (!existsSync(absolute)) {
    return null;
  }
  const info = await stat(absolute);
  return info.isDirectory() ? dirSizeBytes(absolute) : info.size;
}

function isMetaKey(key) {
  return key === "tolerancePercent" || key.startsWith("_");
}

async function main() {
  const raw = await readFile(budgetPath, "utf8");
  const budget = JSON.parse(raw);
  const tolerancePercent = budget.tolerancePercent ?? 5;
  const entryKeys = Object.keys(budget).filter((key) => !isMetaKey(key));

  const rows = [];
  let failed = false;

  for (const targetPath of entryKeys) {
    const baseline = budget[targetPath];
    const measured = await measure(targetPath);

    let status;
    let detail = "";

    if (measured === null) {
      if (baseline === null || baseline === undefined) {
        status = "MISSING (no baseline)";
      } else {
        status = "FAIL (missing)";
        failed = true;
        detail = `expected ~${formatBytes(baseline)}, artifact not found at ${targetPath}`;
      }
    } else if (baseline === null || baseline === undefined) {
      status = "OK (no baseline yet -- record this)";
    } else {
      const limit = baseline * (1 + tolerancePercent / 100);
      if (measured > limit) {
        status = "FAIL (over budget)";
        failed = true;
        const overPercent = ((measured / baseline - 1) * 100).toFixed(1);
        detail = `+${overPercent}% over baseline (limit ${formatBytes(limit)})`;
      } else {
        status = "OK";
      }
    }

    rows.push({
      path: targetPath,
      baseline: baseline === null || baseline === undefined ? null : formatBytes(baseline),
      measured: measured === null ? "n/a" : formatBytes(measured),
      status,
      detail,
    });
  }

  console.log(`\nSize budget check (tolerance: ${tolerancePercent}%)\n`);
  for (const row of rows) {
    const line = `${row.status.padEnd(38)} ${row.path.padEnd(38)} measured=${row.measured.padEnd(10)} baseline=${row.baseline ?? "null"}`;
    console.log(row.detail ? `${line}  (${row.detail})` : line);
  }
  console.log("");

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [];
    lines.push("### Size budget");
    lines.push("");
    lines.push(`Tolerance: ${tolerancePercent}%`);
    lines.push("");
    lines.push("| Path | Measured | Baseline | Status | Detail |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(
        `| \`${row.path}\` | ${row.measured} | ${row.baseline ?? "_none_"} | ${row.status} | ${row.detail || "-"} |`
      );
    }
    lines.push("");
    await appendFile(summaryPath, lines.join("\n") + "\n");
  }

  if (failed) {
    console.error("Size budget check failed: one or more artifacts exceeded their budget.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("check-size.mjs crashed:", error);
  process.exit(1);
});
