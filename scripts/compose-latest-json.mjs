#!/usr/bin/env node
// scripts/compose-latest-json.mjs
//
// Builds the updater manifest for a release from the signatures already
// attached to it, in one pass, from one job.
//
// This exists to let the three platform builds run at the same time.
// tauri-action writes `latest.json` itself, by downloading the release's
// existing copy, merging its own platform in and re-uploading it — a
// read-modify-write across three jobs on three machines. That is why the
// bundle matrix was `max-parallel: 1`, and serialising it cost 42 of the 74
// minutes the v0.1.2 release took: Windows 26m, then macOS 32m, then Linux
// 15m, each waiting on the one before it for no reason but this file.
//
// The failure that serialisation was avoiding is real and worth restating,
// because it is the quiet kind. Two jobs that read the same manifest and both
// write it back lose one platform's entry, and a missing entry is not an
// error anywhere — GitHub accepts the upload, the release looks complete, and
// one operating system simply stops being offered updates until somebody
// notices months later. Serialising made that unlikely. Composing the file
// once, after every platform has finished, makes it impossible: there is only
// ever one writer.
//
// The signatures are the source of truth rather than anything passed between
// jobs. Every updater artifact is uploaded beside a detached `.sig`, so the
// set of `.sig` assets on the release *is* the set of things that built and
// signed, and reading them back is also a check that they survived the
// upload. A platform that failed to build has no signature and therefore no
// entry, which is exactly right — and the required-key check below turns that
// silent gap into a failed job.
//
//   node scripts/compose-latest-json.mjs --tag v0.1.3 --repo owner/name
//   node scripts/compose-latest-json.mjs --tag v0.1.2 --repo owner/name \
//     --out /tmp/latest.json --no-upload      # compose only, change nothing
//
// Needs `gh` authenticated. Assets are fetched through the API rather than
// the public download URL because the release is still a draft when this
// runs, and a draft's assets 404 for anyone not carrying the token.

import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

/** How an artifact's filename maps to updater platform keys.
 *
 *  Tauri writes several keys per artifact and the client resolves the most
 *  specific one it can, so both the bare `{os}-{arch}` and the
 *  `{os}-{arch}-{format}` forms have to be present, or an updater that asks
 *  for the suffixed key finds nothing. The bare key goes to the format that
 *  actually updates in place on that platform: nsis on Windows, the .app
 *  tarball on macOS, the AppImage on Linux. A .deb cannot update itself, so
 *  it claims only its own suffixed key — which is what tauri-action emitted
 *  for v0.1.2, and that file is the one this script has to keep producing.
 *
 *  The macOS entry covers both architectures from one artifact because the
 *  build is `--target universal-apple-darwin`. If that ever splits into two
 *  per-arch builds, this rule splits with it. */
const RULES = [
  {
    format: "nsis",
    match: (name) => name.endsWith(".exe.sig"),
    keys: ["windows-x86_64", "windows-x86_64-nsis"],
  },
  {
    format: "app",
    match: (name) => name.endsWith(".app.tar.gz.sig"),
    // Keyed off the architecture tauri-action stamps into the filename, which
    // is the one asset name it rewrites rather than passing through from the
    // CLI: `.app.tar.gz` and its signature always gain an `_<arch>` suffix, so
    // `Essay_universal.app.tar.gz` and `Essay_aarch64.app.tar.gz` can sit on
    // the same release without colliding.
    //
    // Both shapes are handled because both are reachable. A universal build is
    // one artifact claiming both architectures; splitting macOS into two
    // per-arch jobs — which is how the 31-minute long pole gets cut in half,
    // since a universal build compiles the whole graph once per architecture —
    // produces two artifacts each claiming one. Reading the arch out of the
    // name means this file does not care which was chosen.
    keys: (name) => {
      const arch = name
        .slice(0, -".app.tar.gz.sig".length)
        .split("_")
        .pop()
        .toLowerCase();
      if (arch === "universal") {
        return [
          "darwin-aarch64",
          "darwin-x86_64",
          "darwin-aarch64-app",
          "darwin-x86_64-app",
        ];
      }
      // tauri reports the same architecture under several spellings depending
      // on where the string came from; normalise to what the updater looks up.
      const normalised =
        { arm64: "aarch64", amd64: "x86_64", x64: "x86_64", x86_64: "x86_64" }[
          arch
        ] ?? arch;
      return [`darwin-${normalised}`, `darwin-${normalised}-app`];
    },
  },
  {
    format: "appimage",
    match: (name) => name.endsWith(".AppImage.sig"),
    keys: ["linux-x86_64", "linux-x86_64-appimage"],
  },
  {
    format: "deb",
    match: (name) => name.endsWith(".deb.sig"),
    keys: ["linux-x86_64-deb"],
  },
];

/** The keys an installed copy of Essay actually looks up. A release missing
 *  any of these is one where a platform stopped being offered updates, so it
 *  is a failed job rather than a warning. The `-app`/`-nsis`/`-appimage`
 *  suffixed keys are deliberately not required: they are aliases of these. */
const REQUIRED = [
  "windows-x86_64",
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
];

function parseArgs(argv) {
  const opts = { upload: true, out: null, tag: null, repo: null, require: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tag") opts.tag = argv[++i];
    else if (arg === "--repo") opts.repo = argv[++i];
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--no-upload") opts.upload = false;
    else if (arg === "--require") opts.require = argv[++i].split(",");
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!opts.tag || !opts.repo) {
    console.error(
      "usage: compose-latest-json.mjs --tag <v0.0.0> --repo <owner/name> [--out FILE] [--no-upload]",
    );
    process.exit(2);
  }
  return opts;
}

function gh(args, binary = false) {
  return execFileSync("gh", args, {
    encoding: binary ? "buffer" : "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

/** Found by listing rather than by `releases/tags/<tag>`, because that
 *  endpoint 404s on drafts and the release is still a draft when this runs —
 *  the same reason the publish step lists. */
function findRelease(repo, tag) {
  const raw = gh([
    "api",
    `repos/${repo}/releases`,
    "--paginate",
    "--jq",
    `[.[] | select(.tag_name == "${tag}")][0]`,
  ]).trim();
  if (!raw || raw === "null") {
    console.error(`::error::no release found for tag ${tag}`);
    process.exit(1);
  }
  return JSON.parse(raw);
}

function fetchAssetText(repo, assetId) {
  return gh(
    [
      "api",
      `repos/${repo}/releases/assets/${assetId}`,
      "-H",
      "Accept: application/octet-stream",
    ],
    true,
  )
    .toString("utf8")
    .trim();
}

const opts = parseArgs(process.argv.slice(2));
const required = opts.require ?? REQUIRED;
const release = findRelease(opts.repo, opts.tag);
const version = opts.tag.replace(/^v/, "");

const platforms = {};
const seen = [];

for (const asset of release.assets ?? []) {
  if (!asset.name.endsWith(".sig")) continue;
  const rule = RULES.find((r) => r.match(asset.name));
  if (!rule) {
    // Loud rather than skipped: an artifact that signs but matches no rule is
    // a bundle target someone added without teaching this script about it,
    // and silently dropping it is the exact failure the file exists to stop.
    console.error(`::error::no platform rule matches signature ${asset.name}`);
    process.exit(1);
  }
  const target = asset.name.slice(0, -".sig".length);
  const url = `https://github.com/${opts.repo}/releases/download/${opts.tag}/${encodeURIComponent(target)}`;
  const signature = fetchAssetText(opts.repo, asset.id);
  if (!signature) {
    console.error(`::error::signature ${asset.name} is empty`);
    process.exit(1);
  }
  const keys =
    typeof rule.keys === "function" ? rule.keys(asset.name) : rule.keys;
  for (const key of keys) {
    // Two artifacts claiming one platform key is a release that would ship
    // whichever happened to be read last. It cannot happen with the rules
    // above, and saying so out loud is what keeps that true if someone adds a
    // bundle target later.
    if (key in platforms) {
      console.error(
        `::error::${asset.name} and an earlier artifact both claim ${key}`,
      );
      process.exit(1);
    }
    platforms[key] = { signature, url };
  }
  seen.push(`${rule.format.padEnd(9)} ${target} -> ${keys.join(", ")}`);
}

const missing = required.filter((key) => !(key in platforms));
if (missing.length) {
  console.error(
    `::error::latest.json would omit ${missing.join(", ")} — those platforms stop being offered updates. Refusing to write it.`,
  );
  process.exit(1);
}

const manifest = {
  version,
  notes: release.body ?? "",
  pub_date: new Date().toISOString(),
  platforms,
};

const out = opts.out ?? "latest.json";
await writeFile(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`composed ${out} for ${opts.tag} from ${seen.length} signatures:`);
for (const line of seen) console.log(`  ${line}`);
console.log(`  -> ${Object.keys(platforms).length} platform keys`);

if (opts.upload) {
  gh(["release", "upload", opts.tag, out, "--clobber", "--repo", opts.repo]);
  console.log(`uploaded ${out} to ${opts.tag}`);
}
