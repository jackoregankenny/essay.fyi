#!/usr/bin/env node
// scripts/prune-target.mjs
//
// Garbage-collects target/, which cargo never does.
//
// Cargo addresses every artifact by a metadata hash over the crate's
// configuration — its features, its profile, its dependency versions, the
// compiler that built it. Change any of those and the next build writes a new
// hash and keeps the old one, forever, against the chance you switch back.
// Nothing ever collects them. On this repo that is not a rounding error:
// measured on 2026-08-17, target/ held 34.4 GB, of which
// target/debug/incremental alone was 21.4 GB across 353 directories — 229 of
// them untouched for fifteen days or more, against 12 written that day.
//
// The rule, applied to every group below:
//
//   an entry is deleted only if BOTH
//     (a) nothing has written to it for --min-age-days, and
//     (b) it is not among the newest --keep hashes for its crate.
//
// Both halves are load-bearing, and neither alone is safe.
//
// Age alone is what `cargo sweep --time` does, and it is wrong here. Cargo
// does not touch an artifact it finds fresh, so a Typst rlib compiled six
// weeks ago and correct ever since has a six-week-old mtime while being the
// one the next build will link. Deleting it is minutes of codegen to rebuild
// something that was never stale. Typst is most of this workspace's build
// time, so that false positive is exactly the one to avoid.
//
// Hash-rank alone is wrong in the other direction: it would delete the other
// branch's artifacts the moment you switched, which is the case caching exists
// for. The age floor is what makes switching between two branches all week
// cost nothing — both configurations stay warm because both keep being
// written to.
//
// What survives the pair is what the comment at the top describes: the
// configurations you genuinely stopped building. Restoring one costs a
// rebuild, never correctness — nothing here can produce a wrong binary, only a
// slower build of a configuration you had already abandoned.
//
// Deliberately age-based rather than a size cap, despite scripts/
// size-budget.json setting the opposite precedent. Enforcing a cap means
// knowing the total, and knowing the total means a recursive walk of every
// byte in target/ — tens of seconds on Windows, on a script whose whole point
// is to run in front of `bun run app`. Sizes are measured only for entries
// already condemned, so a run that deletes nothing reads a few hundred
// directory stats and exits.
//
//   node scripts/prune-target.mjs                 prune with the defaults
//   node scripts/prune-target.mjs --dry-run -v    show what would go, delete nothing
//   node scripts/prune-target.mjs --if-stale 12   no-op unless 12h since the last run
//   node scripts/prune-target.mjs --min-age-days 3 --keep 1    more aggressive
//
// Runs under both bun and node, with no dependencies, like check-size.mjs.

import { readdir, stat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const targetDir = path.join(repoRoot, "target");
const stampPath = path.join(targetDir, ".prune-stamp");

/** Profile directories to sweep. Anything else under target/ (`tmp`, a
    cross-compilation triple, CACHEDIR.TAG) is left alone: this script only
    touches layouts it recognises. */
const PROFILES = ["debug", "release"];

/** The groups within a profile, and how many hashes per crate each keeps.
    `incremental` keeps one because it is pure cache — rustc rebuilds it from
    nothing and it is by far the biggest consumer. The rest keep two, which
    covers the common case of a crate that legitimately builds under more than
    one configuration at once (a lib and its test harness, a host build script
    beside a target build) without keeping a third generation of anything. */
const GROUPS = [
  { name: "incremental", keep: 1 },
  { name: "deps", keep: 2 },
  { name: "build", keep: 2 },
  { name: ".fingerprint", keep: 2 },
  { name: "examples", keep: 2 },
];

/** Default for (a): nothing written to in this many days is a candidate. A
    week is chosen so that a fortnight's holiday does not cost the warm cache
    of the branch you left, but a configuration you moved off last month does
    not survive to next month. */
const DEFAULT_MIN_AGE_DAYS = 7;

function parseArgs(argv) {
  const options = {
    dryRun: false,
    verbose: false,
    minAgeDays: DEFAULT_MIN_AGE_DAYS,
    keepOverride: null,
    ifStaleHours: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "-n") options.dryRun = true;
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg === "--min-age-days") options.minAgeDays = Number(argv[++i]);
    else if (arg === "--keep") options.keepOverride = Number(argv[++i]);
    else if (arg === "--if-stale") options.ifStaleHours = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

/** Split a cargo artifact name into the crate it belongs to and the metadata
    hash that distinguishes one configuration of it from another.
 *
 *  Entries look like `essay_render-3gmrq490vxg0p` (a directory under
 *  incremental/ or .fingerprint/) or `libessay_render-3gmrq490vxg0p.rlib`,
 *  `essay_render-3gmrq490vxg0p.pdb`, `app_lib-1a2b3c4d.dll.lib` (files under
 *  deps/). The hash is the last `-`-delimited run of lowercase alphanumerics
 *  before the first dot.
 *
 *  Returns null for anything that does not match, and a null result is never
 *  deleted. That is the intended failure mode: an unfamiliar name means a
 *  layout this script does not understand, and the cost of keeping it is disk
 *  while the cost of guessing is someone's build. */
function parseArtifactName(entryName) {
  const firstDot = entryName.indexOf(".");
  const stem = firstDot === -1 ? entryName : entryName.slice(0, firstDot);
  const suffix = firstDot === -1 ? "" : entryName.slice(firstDot);

  const split = stem.lastIndexOf("-");
  if (split <= 0) return null;

  const hash = stem.slice(split + 1);
  // Cargo's metadata hashes are 16 characters of lowercase base-36-ish text.
  // The bound is loose at both ends because the encoding has changed between
  // toolchains, but it still refuses to treat `essay-cli` as `essay` + `cli`.
  if (!/^[0-9a-z]{8,20}$/.test(hash)) return null;

  // `libessay_render` and `essay_render` are the same crate wearing the
  // platform's naming convention; grouping them apart would keep two copies of
  // everything and defeat the point.
  let crate = stem.slice(0, split);
  if (crate.startsWith("lib")) crate = crate.slice(3);

  return { crate, hash, suffix };
}

async function directorySizeBytes(dirPath) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) total += await directorySizeBytes(entryPath);
      else if (entry.isFile()) total += (await stat(entryPath)).size;
    } catch {
      // A file that vanished mid-walk (a concurrent cargo run) contributes
      // nothing rather than aborting the report.
    }
  }
  return total;
}

/** Collect every entry of one group, keyed by crate and hash.
 *
 *  A hash group is a set of entries sharing a crate and a hash — under deps/
 *  that is the rlib, the .d, the .pdb and friends, which must be judged
 *  together and deleted together. Its mtime is the newest of its members,
 *  because writing any one of them is evidence the configuration is in use. */
async function collectHashGroups(groupPath) {
  let entries;
  try {
    entries = await readdir(groupPath, { withFileTypes: true });
  } catch {
    return null; // group absent for this profile — nothing to do
  }

  /** @type {Map<string, {crate: string, hash: string, mtimeMs: number, paths: string[]}>} */
  const groups = new Map();
  let skipped = 0;

  for (const entry of entries) {
    const parsed = parseArtifactName(entry.name);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    const entryPath = path.join(groupPath, entry.name);
    let info;
    try {
      info = await stat(entryPath);
    } catch {
      continue;
    }

    const key = `${parsed.crate} ${parsed.hash}`;
    const existing = groups.get(key);
    if (existing) {
      existing.mtimeMs = Math.max(existing.mtimeMs, info.mtimeMs);
      existing.paths.push(entryPath);
    } else {
      groups.set(key, {
        crate: parsed.crate,
        hash: parsed.hash,
        mtimeMs: info.mtimeMs,
        paths: [entryPath],
      });
    }
  }

  return { groups: [...groups.values()], skipped };
}

/** Apply the two-part rule to one group directory and return what it condemns. */
function condemn(hashGroups, { keep, minAgeMs, now }) {
  /** @type {Map<string, typeof hashGroups>} */
  const byCrate = new Map();
  for (const group of hashGroups) {
    const list = byCrate.get(group.crate);
    if (list) list.push(group);
    else byCrate.set(group.crate, [group]);
  }

  const doomed = [];
  for (const [, groupsForCrate] of byCrate) {
    // Newest first, so the survivors are the configurations most recently built.
    groupsForCrate.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const group of groupsForCrate.slice(keep)) {
      // (a) the age floor. Applied after the rank test rather than before, so
      // that a crate whose every configuration is old still keeps `keep` of
      // them: the survivors are chosen by rank, and only the losers are then
      // asked how old they are.
      if (now - group.mtimeMs < minAgeMs) continue;
      doomed.push(group);
    }
  }
  return doomed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(
      [
        "Usage: node scripts/prune-target.mjs [options]",
        "",
        "  -n, --dry-run          report what would be removed, remove nothing",
        "  -v, --verbose          list every condemned entry",
        "      --min-age-days N   only touch entries untouched for N days " +
          `(default ${DEFAULT_MIN_AGE_DAYS})`,
        "      --keep N           hashes to keep per crate, overriding the per-group default",
        "      --if-stale H       exit immediately unless H hours have passed since the last run",
      ].join("\n")
    );
    return;
  }

  if (!Number.isFinite(options.minAgeDays) || options.minAgeDays < 0) {
    throw new Error("--min-age-days must be a non-negative number");
  }

  // Never in CI. `bun run build` is wired to `prune:auto` and CI runs it, so
  // without this the pruner meets a `target/` that Swatinem/rust-cache has just
  // restored — with the mtimes it was archived at, which are always old. The
  // hash-rank half of the rule would almost certainly spare it (a cache holds
  // one configuration per crate, and `keep` is 2), but "almost certainly" is
  // not the bar for something that would present as a mysteriously slow build
  // and nothing else. The runner's disk is thrown away at the end of the job
  // regardless: there is nothing here for this script to do.
  if (process.env.CI) {
    if (options.verbose) console.log("prune-target: CI, skipping");
    return;
  }

  const now = Date.now();

  // The throttle. This script is wired in front of dev and build commands, and
  // an author who runs `bun run app` six times an hour should pay for it once.
  // Checked against a stamp rather than remembered in a process, because every
  // one of those runs is a new process.
  if (options.ifStaleHours !== null) {
    try {
      const stamp = await stat(stampPath);
      const hoursSince = (now - stamp.mtimeMs) / 3_600_000;
      if (hoursSince < options.ifStaleHours) {
        if (options.verbose) {
          console.log(
            `prune-target: last run ${hoursSince.toFixed(1)}h ago, skipping`
          );
        }
        return;
      }
    } catch {
      // No stamp yet: this is the first run, which is exactly when there is
      // most to collect.
    }
  }

  let totalBytes = 0;
  let totalEntries = 0;
  const perGroup = [];

  for (const profile of PROFILES) {
    for (const group of GROUPS) {
      const groupPath = path.join(targetDir, profile, group.name);
      const collected = await collectHashGroups(groupPath);
      if (!collected) continue;

      const keep = options.keepOverride ?? group.keep;
      const doomed = condemn(collected.groups, {
        keep,
        minAgeMs: options.minAgeDays * 86_400_000,
        now,
      });
      if (doomed.length === 0) continue;

      let bytes = 0;
      let paths = 0;
      for (const victim of doomed) {
        for (const victimPath of victim.paths) {
          let info;
          try {
            info = await stat(victimPath);
          } catch {
            continue;
          }
          bytes += info.isDirectory()
            ? await directorySizeBytes(victimPath)
            : info.size;
          paths += 1;

          if (options.verbose) {
            const ageDays = ((now - victim.mtimeMs) / 86_400_000).toFixed(0);
            console.log(
              `  ${options.dryRun ? "would remove" : "removing"} ${path.relative(repoRoot, victimPath)} (${ageDays}d)`
            );
          }
          if (!options.dryRun) {
            // `force` so a concurrent cargo run that already removed this is
            // not an error; `maxRetries` for Windows, where an antivirus scan
            // or a file handle in flight makes a delete fail once and succeed
            // a moment later.
            await rm(victimPath, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 100,
            });
          }
        }
      }

      totalBytes += bytes;
      totalEntries += paths;
      perGroup.push({
        label: `${profile}/${group.name}`,
        hashGroups: doomed.length,
        entries: paths,
        bytes,
      });
    }
  }

  if (totalEntries === 0) {
    console.log("prune-target: nothing stale in target/");
  } else {
    console.log(
      `\nprune-target: ${options.dryRun ? "would reclaim" : "reclaimed"} ${formatBytes(totalBytes)} ` +
        `(${totalEntries} entries, min age ${options.minAgeDays}d)\n`
    );
    for (const row of perGroup) {
      console.log(
        `  ${row.label.padEnd(24)} ${formatBytes(row.bytes).padStart(10)}  ` +
          `${row.hashGroups} stale configuration${row.hashGroups === 1 ? "" : "s"}`
      );
    }
    console.log("");
  }

  // Stamped even when nothing was found, and even on a dry run's behalf only
  // when it actually ran: the throttle asks "has this been looked at lately?",
  // and a look that found nothing is still a look.
  if (!options.dryRun) {
    try {
      await writeFile(stampPath, new Date(now).toISOString());
    } catch {
      // target/ may not exist yet on a fresh clone. Nothing to prune there
      // either, so there is nothing to report.
    }
  }
}

main().catch((error) => {
  // Never fatal. This runs in front of dev and build commands, and disk
  // hygiene failing is not a reason to stop someone building.
  console.error(`prune-target: ${error.message}`);
  process.exit(0);
});
