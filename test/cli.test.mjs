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
  expect(result.stdout).toMatch(/--api/);
  expect(result.stdout).toMatch(/--apiPort/);
  expect(result.stdout).toMatch(/--shuffle/);
});

test("cli validates API port and mode conflicts before loading Realm", () => {
  const badPort = runCli(["--api", "--apiPort", "70000"]);
  expect(badPort.status).not.toBe(0);
  expect(`${badPort.stdout}\n${badPort.stderr}`).toMatch(
    /--apiPort must be an integer between 1 and 65535/,
  );

  const conflict = runCli(["--api", "--loop"]);
  expect(conflict.status).not.toBe(0);
  expect(`${conflict.stdout}\n${conflict.stderr}`).toMatch(
    /--api cannot be combined with --loop/,
  );
});

test("cli reports a missing Realm database cleanly", () => {
  withTempDir("osu-play-cli", (tempDir) => {
    const result = runCli(["--osuDataDir", path.join(tempDir, "osu")]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/Realm DB not found/);
  });
});
