#!/usr/bin/env bun

import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  throw new Error("Expected a command to run.");
}

const tempDir = path.join(process.cwd(), ".tmp-tooling");
const npmCacheDir = path.join(tempDir, "npm-cache");
const [command, ...commandArgs] = args;

rmSync(tempDir, { force: true, recursive: true });
mkdirSync(tempDir, { recursive: true });
mkdirSync(npmCacheDir, { recursive: true });

try {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      TEMP: tempDir,
      TMP: tempDir,
      TMPDIR: tempDir,
      npm_config_cache: npmCacheDir,
    },
  });

  process.exitCode = result.status ?? 1;
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
