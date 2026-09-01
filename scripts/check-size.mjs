#!/usr/bin/env node
// scripts/check-size.mjs
//
// Size ceiling for release artifacts. Reads scripts/size-budget.json, measures
// the configured paths (a file's byte size, or a directory's recursive total),
// and fails only when one is over its ceiling.
//
// This used to be a baseline plus a percentage tolerance, and the difference
// matters. A tolerance answers "did this grow?", which sounds like the useful
// question and is not: every toolchain bump moves LTO output a percent or two,
// so the check failed for reasons nobody chose and the baselines had to be
// re-recorded to make it green again. A re-recorded baseline is a tripwire
// moved to wherever the wire already was. Twice that happened here, and the
// second time it hid a real 16% frontend regression behind a build-profile
// change that had nothing to do with it.
//
// A ceiling answers "is this too big?", which is the question anyone actually
// has. It does not move when the compiler does, it never needs re-recording to
// pass, and the number in the file is a decision somebody made rather than a
// measurement somebody took. Growth is still visible -- every run prints the
// measured size and the headroom left -- it just is not a failure until it is
// a problem.
//
// Entries whose ceiling is `null` are informational: measured and printed,
// never failed on.
//
// Runs under both `bun` and `node` (no dependencies):
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

/** Keys that configure the file rather than name an artifact. `tolerancePercent`
 *  is listed so an old budget file does not get measured as a path. */
function isMetaKey(key) {
  return key === "tolerancePercent" || key.startsWith("_");
}

async function main() {
  const raw = await readFile(budgetPath, "utf8");
  const budget = JSON.parse(raw);
  const entryKeys = Object.keys(budget).filter((key) => !isMetaKey(key));

  const rows = [];
  let failed = false;

  for (const targetPath of entryKeys) {
    const ceiling = budget[targetPath];
    const measured = await measure(targetPath);

    let status;
    let detail = "";
    let headroom = "";

    if (measured === null) {
      if (ceiling === null || ceiling === undefined) {
        status = "MISSING (informational)";
      } else {
        // A missing artifact is a build that did not produce what this file
        // says it produces, which is worth failing on even though it is not a
        // size problem.
        status = "FAIL (missing)";
        failed = true;
        detail = `nothing at ${targetPath} -- did the build produce it?`;
      }
    } else if (ceiling === null || ceiling === undefined) {
      status = "OK (informational)";
      headroom = "no ceiling";
    } else if (measured > ceiling) {
      status = "FAIL (over ceiling)";
      failed = true;
      const over = measured - ceiling;
      detail = `${formatBytes(over)} over the ${formatBytes(ceiling)} ceiling`;
      headroom = `-${formatBytes(over)}`;
    } else {
      status = "OK";
      const left = ceiling - measured;
      const pct = ((measured / ceiling) * 100).toFixed(0);
      headroom = `${formatBytes(left)} left (${pct}% used)`;
    }

    rows.push({
      path: targetPath,
      ceiling: ceiling === null || ceiling === undefined ? null : formatBytes(ceiling),
      measured: measured === null ? "n/a" : formatBytes(measured),
      status,
      headroom,
      detail,
    });
  }

  console.log(`\nSize ceilings\n`);
  for (const row of rows) {
    const line = `${row.status.padEnd(24)} ${row.path.padEnd(38)} measured=${row.measured.padEnd(10)} ceiling=${(row.ceiling ?? "none").padEnd(10)} ${row.headroom}`;
    console.log(row.detail ? `${line}  (${row.detail})` : line);
  }
  console.log("");

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [];
    lines.push("### Size ceilings");
    lines.push("");
    lines.push("| Path | Measured | Ceiling | Headroom | Status |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(
        `| \`${row.path}\` | ${row.measured} | ${row.ceiling ?? "_none_"} | ${row.headroom || "-"} | ${row.status}${row.detail ? ` — ${row.detail}` : ""} |`
      );
    }
    lines.push("");
    await appendFile(summaryPath, lines.join("\n") + "\n");
  }

  if (failed) {
    console.error("Size check failed: an artifact is over its ceiling, or missing.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("check-size.mjs crashed:", error);
  process.exit(1);
});
