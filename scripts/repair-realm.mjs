#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const forceRepair = process.argv.includes("--force");

// Realm ships its native binding as a Node-API (N-API) prebuilt binary. N-API
// binaries are ABI-stable across Node versions, so the one binary works on every
// supported runtime (Node 20 through the latest). The only catch is that Bun's
// `install` does not run Realm's lifecycle script successfully — Realm's
// `prebuild-install --runtime napi` invocation can't infer the N-API target and
// silently bails (`|| echo 'Failed to download prebuild for Realm'`), leaving
// `prebuilds/node/realm.node` missing. This script fetches that binary directly.

function canLoadRealm() {
  const result = spawnSync(
    "node",
    [
      "-e",
      "const Realm = require('realm'); if (typeof Realm.shutdown === 'function') Realm.shutdown(); console.log('realm-ok');",
    ],
    { cwd: process.cwd(), encoding: "utf8", env: process.env },
  );

  return result.status === 0;
}

if (!forceRepair && canLoadRealm()) {
  console.log("[realm] Native bindings already look healthy.");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const realmDir = dirname(require.resolve("realm/package.json"));
const prebuildInstallBin = createRequire(`${realmDir}/`).resolve(
  "prebuild-install/bin.js",
);

console.log("[realm] Downloading the N-API prebuilt binding for Realm...");

const download = spawnSync(
  process.execPath,
  [prebuildInstallBin, "--runtime", "napi", "--target", "6"],
  {
    cwd: realmDir,
    encoding: "utf8",
    env: { ...process.env, REALM_DISABLE_ANALYTICS: "1" },
    stdio: "inherit",
  },
);

if (download.status !== 0) {
  console.error("[realm] Failed to download the Realm prebuilt binary.");
  process.exit(download.status ?? 1);
}

if (!canLoadRealm()) {
  console.error("[realm] Download completed, but Node still cannot load Realm.");
  process.exit(1);
}

console.log("[realm] Native bindings repaired successfully.");
