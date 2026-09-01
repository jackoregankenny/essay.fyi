#!/usr/bin/env node
// scripts/release.mjs
//
// Cuts a release: sets the version everywhere it is written down, commits it,
// and tags it. Pushing that tag is what runs .github/workflows/release.yml,
// which builds an installer per desktop platform, signs the updater artifacts
// and publishes them as one GitHub release.
//
// This script exists because the version is recorded in more than one file and
// only one of them is checked. `release.yml`'s guard job compares the tag
// against `apps/desktop/src-tauri/tauri.conf.json`, because that is the number
// the updater serves in `latest.json` and compares against what each installed
// copy is running — tag `v0.2.0` without bumping it and the release builds,
// publishes, and is offered to nobody, silently. The workspace version in
// Cargo.toml is not checked by anything, which is exactly why it drifts. Both
// are set here, from one argument, so they cannot disagree.
//
//   node scripts/release.mjs patch          0.1.0 -> 0.1.1
//   node scripts/release.mjs minor          0.1.0 -> 0.2.0
//   node scripts/release.mjs major          0.1.0 -> 1.0.0
//   node scripts/release.mjs 0.4.2          set it exactly
//   node scripts/release.mjs minor --dry-run    show the edits, change nothing
//
// The tag is never pushed for you, and `--push` is the only way to make this
// script do it. Pushing is the irreversible half: it starts three platform
// builds and ends with a public release that installed copies of Essay will
// fetch on their next hourly check. Cutting the commit and the tag is local and
// undoable (`git tag -d`, `git reset --hard HEAD~1`); publishing is neither.
//
// Runs under both bun and node, with no dependencies.

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const tauriConfPath = path.join(
  repoRoot,
  "apps/desktop/src-tauri/tauri.conf.json"
);
const cargoTomlPath = path.join(repoRoot, "Cargo.toml");
const changelogPath = path.join(
  repoRoot,
  "apps/desktop/src/content/changelog.md"
);

function git(args, { capture = true } = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  })?.trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function bump(current, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) fail(`current version "${current}" is not major.minor.patch`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || argv.includes("-n");
  const push = argv.includes("--push");
  const allowDirty = argv.includes("--allow-dirty");
  const positional = argv.filter((arg) => !arg.startsWith("-"));

  if (positional.length !== 1) {
    console.log(
      [
        "Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [options]",
        "",
        "  -n, --dry-run      print the edits and stop",
        "      --push         push the branch and the tag, starting the release build",
        "      --allow-dirty  skip the clean-worktree check",
      ].join("\n")
    );
    process.exit(positional.length === 0 ? 0 : 1);
  }

  const tauriRaw = await readFile(tauriConfPath, "utf8");
  const tauriConf = JSON.parse(tauriRaw);
  const current = tauriConf.version;

  const request = positional[0];
  const next = /^\d+\.\d+\.\d+$/.test(request)
    ? request
    : ["major", "minor", "patch"].includes(request)
      ? bump(current, request)
      : fail(`"${request}" is neither a bump kind nor a major.minor.patch version`);

  if (next === current) fail(`already at ${current}`);
  const tag = `v${next}`;

  // The changelog has to name this version before the tag exists.
  //
  // `lib/changelog.ts` parses this file and the help tab in the footer shows
  // the newest entry it finds, so a release with no entry does not show
  // nothing -- it shows the *previous* release's summary, to everyone, as
  // though it were current. That is not hypothetical: the file said
  // "0.1.0 -- Unreleased" through both v0.1.1 and v0.1.2, because nothing
  // between writing a version down and pushing a tag ever asked.
  //
  // Checked here rather than in CI because here is where it is still cheap to
  // fix: the alternative is a red release workflow after the tag is public.
  const changelog = await readFile(changelogPath, "utf8");
  const heading = new RegExp(`^##\\s+${next.replace(/\./g, "\\.")}\\b`, "m");
  if (!heading.test(changelog)) {
    fail(
      [
        `apps/desktop/src/content/changelog.md has no "## ${next}" entry.`,
        "",
        "The help tab shows the newest entry in that file, so releasing without",
        `one shows the previous release's summary as if it were ${next}.`,
        "",
        "Add a heading, a one-line summary paragraph, and whatever `###`",
        "sections apply, then run this again.",
      ].join("\n")
    );
  }

  // Checked before anything is written. A release cut on top of unrelated
  // uncommitted work commits that work too, under a message that says it is a
  // version bump — and the first anyone knows is when it is in a published tag.
  if (!allowDirty) {
    const status = git(["status", "--porcelain"]);
    if (status) {
      fail(
        "the worktree is not clean. Commit or stash first, or pass --allow-dirty " +
          "if you mean to include the changes in the release commit."
      );
    }
  }

  const existingTags = git(["tag", "--list", tag]);
  if (existingTags) fail(`tag ${tag} already exists`);

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

  // The version lives in two files with two syntaxes. tauri.conf.json is
  // re-serialised from the parse; Cargo.toml is edited by a narrow substitution
  // rather than a TOML round-trip, because that file is mostly the reasoning
  // behind the release and dev profiles and a rewrite would discard it.
  const nextTauriRaw = tauriRaw.replace(
    /("version"\s*:\s*)"[^"]*"/,
    `$1"${next}"`
  );
  if (nextTauriRaw === tauriRaw) fail("could not find a version field in tauri.conf.json");

  const cargoRaw = await readFile(cargoTomlPath, "utf8");
  const nextCargoRaw = cargoRaw.replace(
    /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*)"[^"]*"/,
    `$1"${next}"`
  );
  if (nextCargoRaw === cargoRaw) {
    fail("could not find [workspace.package] version in Cargo.toml");
  }

  console.log(`\nrelease: ${current} -> ${next}  (tag ${tag}, branch ${branch})\n`);
  console.log("  apps/desktop/src-tauri/tauri.conf.json   version");
  console.log("  Cargo.toml                               [workspace.package] version");

  if (dryRun) {
    console.log("\n(dry run — nothing written)\n");
    return;
  }

  await writeFile(tauriConfPath, nextTauriRaw);
  await writeFile(cargoTomlPath, nextCargoRaw);

  // Cargo.lock records the workspace crates' own versions, so it is stale the
  // moment the line above lands. Refreshed by asking cargo to resolve rather
  // than by editing the lockfile: `--offline` because a release bump is not the
  // moment to discover a registry is unreachable, and this needs no network to
  // renumber crates it already has.
  try {
    execFileSync("cargo", ["metadata", "--format-version", "1", "--offline"], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    console.warn(
      "release: could not refresh Cargo.lock (cargo metadata failed) — " +
        "check it in before pushing"
    );
  }

  git(["add", "Cargo.toml", "Cargo.lock", "apps/desktop/src-tauri/tauri.conf.json"]);
  git(["commit", "-m", `Release ${tag}`]);
  git(["tag", "-a", tag, "-m", `Essay ${tag}`]);

  console.log(`\ncommitted and tagged ${tag}.`);

  if (!push) {
    console.log(
      [
        "",
        "Nothing has been pushed. To publish:",
        "",
        `  git push origin ${branch} && git push origin ${tag}`,
        "",
        "That starts three platform builds and ends with a public release that",
        "installed copies will offer on their next check. To undo instead:",
        "",
        `  git tag -d ${tag} && git reset --hard HEAD~1`,
        "",
      ].join("\n")
    );
    return;
  }

  console.log(`pushing ${branch} and ${tag}...`);
  git(["push", "origin", branch], { capture: false });
  git(["push", "origin", tag], { capture: false });
  console.log(
    `\npushed. Watch it at https://github.com/jackoregankenny/essay.fyi/actions\n`
  );
}

main().catch((error) => {
  fail(error.message);
});
