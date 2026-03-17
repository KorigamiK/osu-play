import { expect, test } from "bun:test";
import path from "node:path";

import { withTempDir } from "./support/temp-dir.mjs";

const decoder = new TextDecoder();

function runCli(args) {
  const result = Bun.spawnSync(["node", "dist/cli.cjs", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    status: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

test("cli --help exits successfully", () => {
  const result = runCli(["--help"]);

  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/Usage: osu-play \[options\]/);
});

test("cli reports a missing Realm database cleanly", () => {
  withTempDir("osu-play-cli", (tempDir) => {
    const result = runCli(["--osuDataDir", path.join(tempDir, "osu")]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/Realm DB not found/);
  });
});
