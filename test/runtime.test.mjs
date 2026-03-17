import { expect, test } from "bun:test";

const decoder = new TextDecoder();

test("node can load realm bindings", () => {
  const result = Bun.spawnSync(
    [
      "node",
      "-e",
      "const Realm = require('realm'); if (typeof Realm.open !== 'function') process.exit(1); if (typeof Realm.shutdown === 'function') Realm.shutdown();",
    ],
    {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  expect(result.exitCode).toBe(0);
  expect(decoder.decode(result.stderr)).toBe("");
});
