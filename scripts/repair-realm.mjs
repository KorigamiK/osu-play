#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

const forceRepair = process.argv.includes("--force");
const isWindows = process.platform === "win32";
const npxCommand = isWindows ? "npx.cmd" : "npx";
const resolverCommand = isWindows ? "where.exe" : "which";
const npmCommand = isWindows ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    ...options,
  });
}

function resolveNpmPath() {
  const result = run(resolverCommand, [npmCommand]);
  if (result.status !== 0) {
    throw new Error("Could not find `npm` on PATH.");
  }

  const npmPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!npmPath) {
    throw new Error("Could not resolve the npm executable path.");
  }

  return npmPath;
}

function canLoadRealm() {
  const result = run("node", [
    "-e",
    "const Realm = require('realm'); if (typeof Realm.shutdown === 'function') Realm.shutdown(); console.log('realm-ok');",
  ]);

  return result.status === 0;
}

if (!forceRepair && canLoadRealm()) {
  console.log("[realm] Native bindings already look healthy.");
  process.exit(0);
}

console.log("[realm] Repairing native bindings with a temporary Node 20 runtime...");

const npmPath = resolveNpmPath();
const rebuild = spawnSync(
  npxCommand,
  ["-y", "node@20", npmPath, "rebuild", "realm", "--foreground-scripts"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      REALM_DISABLE_ANALYTICS: "1",
    },
  },
);

if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1);
}

if (!canLoadRealm()) {
  console.error("[realm] Repair completed, but Node still cannot load Realm.");
  process.exit(1);
}

console.log("[realm] Native bindings repaired successfully.");
