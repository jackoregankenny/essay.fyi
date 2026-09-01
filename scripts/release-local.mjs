#!/usr/bin/env node
// scripts/release-local.mjs
//
// Builds this platform's release artifacts on this machine and uploads them
// into the tag's draft release.
//
// Why this exists rather than a self-hosted runner. A runner accepts jobs from
// GitHub, and on a *public* repository anyone can fork it, point a workflow at
// `runs-on: self-hosted`, and open a pull request — which is arbitrary code
// execution on whatever machine registered the runner. GitHub's own guidance is
// to never do this on a public repo. A script has no inbound trigger: nothing
// runs unless the person at the keyboard runs it. Same build, same machine, no
// attack surface.
//
// The saving it is for is macOS. On GitHub, macOS bills at roughly ten times
// Linux and is the single most expensive thing either repository does; built on
// a Mac you already own and already leave powered on, it costs nothing and
// starts from a warm target/ instead of a cold runner.
//
//   node scripts/release-local.mjs --tag v0.1.3
//   node scripts/release-local.mjs --tag v0.1.3 --target universal-apple-darwin
//   node scripts/release-local.mjs --tag v0.1.3 --dry-run
//
// It refuses to do anything until it is certain the bytes it is about to sign
// are the bytes of the tag. That is not ceremony. CI builds from a clean
// checkout at a known commit, which is the only reason anyone can trust an
// artifact it produced; a laptop has a working tree, a local toolchain and
// whatever was half-finished last night. Essay ships *signed* artifacts to an
// *auto-updater*, so a build from a dirty tree is signed with the real key,
// accepted by every installed copy, and indistinguishable downstream from a
// real release. The guards below are what buy back the property CI gave away.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** The architecture token tauri-action stamps into `.app.tar.gz` names, keyed
 *  by target triple. Reproduced here because the local CLI does *not* do this
 *  rename — it writes a bare `Essay.app.tar.gz` — while compose-latest-json.mjs
 *  reads the architecture back out of the filename to decide which
 *  `darwin-*` keys the artifact claims. Upload the CLI's name unchanged and the
 *  manifest silently loses macOS. */
const ARCH_BY_TRIPLE = {
  "universal-apple-darwin": "universal",
  "aarch64-apple-darwin": "aarch64",
  "x86_64-apple-darwin": "x86_64",
};

/** Extensions worth uploading. Everything else the bundler leaves behind
 *  (.app directories, intermediate .tar, build logs) is either not a
 *  distributable or cannot be a release asset. */
const UPLOAD = [
  ".dmg",
  ".app.tar.gz",
  ".app.tar.gz.sig",
  ".exe",
  ".exe.sig",
  ".msi",
  ".msi.sig",
  ".deb",
  ".deb.sig",
  ".AppImage",
  ".AppImage.sig",
  ".rpm",
  ".rpm.sig",
];

function parseArgs(argv) {
  const opts = { tag: null, target: null, dryRun: false, upload: true, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") opts.tag = argv[++i];
    else if (a === "--target") opts.target = argv[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--no-upload") opts.upload = false;
    else if (a === "--skip-build") opts.skipBuild = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!opts.tag) {
    console.error("usage: release-local.mjs --tag <v0.0.0> [--target <triple>] [--dry-run]");
    process.exit(2);
  }
  return opts;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : "pipe",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

function die(message) {
  console.error(`\n  refusing: ${message}\n`);
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
const version = opts.tag.replace(/^v/, "");

// ---- guards -------------------------------------------------------------
// Each one answers "could this upload something that is not the tag?".

// 1. A dirty tree is the whole risk in one line.
const status = run("git", ["status", "--porcelain"]).trim();
if (status) {
  die(
    `the working tree is not clean. A local build signs whatever is on disk, and\n` +
      `  the updater cannot tell the difference. Commit, stash or discard first:\n\n` +
      status
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
  );
}

// 2. Being on the tag's commit, not merely near it.
let tagSha;
try {
  tagSha = run("git", ["rev-parse", "--verify", `${opts.tag}^{commit}`]).trim();
} catch {
  die(`tag ${opts.tag} does not exist locally. Cut it with \`bun run release\` first.`);
}
const headSha = run("git", ["rev-parse", "HEAD"]).trim();
if (tagSha !== headSha) {
  die(
    `HEAD is not ${opts.tag}.\n` +
      `    ${opts.tag} -> ${tagSha}\n` +
      `    HEAD    -> ${headSha}\n` +
      `  Check the tag out before building: git checkout ${opts.tag}`,
  );
}

// 3. The same check release.yml's `guard` job makes, for the same reason: the
//    updater compares the version in the manifest — which comes from
//    tauri.conf.json — against what each installed copy is running.
const conf = JSON.parse(
  readFileSync(path.join(repoRoot, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
);
if (conf.version !== version) {
  die(`tag ${opts.tag} does not match tauri.conf.json version ${conf.version}`);
}

// 4. The tag has to exist on the remote, or the release attaches to nothing and
//    every download URL in the manifest 404s.
const remote = run("git", ["ls-remote", "--tags", "origin", opts.tag]).trim();
if (!remote) {
  die(`tag ${opts.tag} has not been pushed. Run: git push origin ${opts.tag}`);
}

// 5. Without the key the bundler still produces installers, just unsigned ones —
//    and an unsigned artifact is rejected by every installed copy with no
//    message that explains why. Better to stop here than to find out from the
//    manifest.
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  die(
    `TAURI_SIGNING_PRIVATE_KEY is not set, so the updater artifacts would be\n` +
      `  unsigned and every installed copy would silently reject them. Export it\n` +
      `  (and TAURI_SIGNING_PRIVATE_KEY_PASSWORD) from ~/.tauri before building.`,
  );
}

console.log(`  tag        ${opts.tag} (${tagSha.slice(0, 12)})`);
console.log(`  version    ${conf.version}`);
console.log(`  target     ${opts.target ?? "host default"}`);
console.log(`  tree       clean`);
console.log(`  signing    key present`);

if (opts.dryRun) {
  console.log("\n  --dry-run: guards passed, nothing built or uploaded.\n");
  process.exit(0);
}

// ---- build --------------------------------------------------------------

if (!opts.skipBuild) {
  const args = ["run", "--cwd", "apps/desktop", "tauri", "build"];
  if (opts.target) args.push("--target", opts.target);
  console.log(`\n  building: bun ${args.join(" ")}\n`);
  run("bun", args, { inherit: true });
}

// ---- collect ------------------------------------------------------------

const bundleRoot = opts.target
  ? path.join(repoRoot, "target", opts.target, "release", "bundle")
  : path.join(repoRoot, "target", "release", "bundle");

if (!existsSync(bundleRoot)) {
  die(`no bundle directory at ${bundleRoot} — did the build actually produce artifacts?`);
}

async function collect(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // `.app` is a directory and cannot be uploaded; its updater form is the
    // `.app.tar.gz` beside it.
    if (entry.isDirectory() && !entry.name.endsWith(".app")) {
      found.push(...(await collect(full)));
    } else if (entry.isFile() && UPLOAD.some((ext) => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

let artifacts = await collect(bundleRoot);

// Apply tauri-action's `_<arch>` rename to the macOS updater artifacts, so the
// names on the release match what compose-latest-json.mjs parses.
const arch = ARCH_BY_TRIPLE[opts.target ?? ""] ?? null;
if (arch) {
  artifacts = artifacts.map((file) => {
    const base = path.basename(file);
    const m = base.match(/^(.*)(\.app\.tar\.gz(?:\.sig)?)$/);
    if (!m || m[1].endsWith(`_${arch}`)) return file;
    const renamed = path.join(path.dirname(file), `${m[1]}_${arch}${m[2]}`);
    renameSync(file, renamed);
    console.log(`  renamed ${base} -> ${path.basename(renamed)}`);
    return renamed;
  });
}

if (artifacts.length === 0) die(`found no uploadable artifacts under ${bundleRoot}`);

console.log(`\n  ${artifacts.length} artifacts:`);
for (const a of artifacts) console.log(`    ${path.relative(repoRoot, a)}`);

if (!opts.upload) {
  console.log("\n  --no-upload: stopping before the release.\n");
  process.exit(0);
}

// ---- upload -------------------------------------------------------------
// Into the draft, exactly as the CI matrix does. Created here if the workflow
// has not already opened it, so a fully-local release works with no run at all.

const repoSlug = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
const existing = run("gh", [
  "api", `repos/${repoSlug}/releases`, "--paginate",
  "--jq", `[.[] | select(.tag_name == "${opts.tag}")][0].id`,
]).trim();

if (!existing || existing === "null") {
  console.log(`\n  creating draft release for ${opts.tag}`);
  run("gh", [
    "release", "create", opts.tag,
    "--draft",
    "--title", `Essay ${opts.tag}`,
    "--notes-file", ".github/release-notes.md",
  ], { inherit: true });
} else {
  console.log(`\n  uploading into existing release ${existing}`);
}

run("gh", ["release", "upload", opts.tag, ...artifacts, "--clobber"], { inherit: true });

console.log(`
  uploaded. The release is still a draft.

  Next, once every platform has landed its artifacts:
    node scripts/compose-latest-json.mjs --tag ${opts.tag} --repo ${repoSlug}
    gh release edit ${opts.tag} --draft=false --latest

  Compose refuses to write a manifest that omits a platform, so if a leg has
  not been built or uploaded yet it will say so rather than publishing a
  release that stops offering updates to that OS.
`);
