import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getRealmDBPath } from "../src/core/utils/mod.ts";
import { withTempDir } from "./support/temp-dir.mjs";

test("getRealmDBPath returns osu!lazer's live database path", () => {
  withTempDir("osu-play-utils", (rootDir) => {
    const osuDataDir = path.join(rootDir, "osu");
    const osuRealmPath = path.join(osuDataDir, "client.realm");

    mkdirSync(osuDataDir, { recursive: true });
    writeFileSync(osuRealmPath, "realm-data");

    const realmPath = getRealmDBPath({ osuDataDir });

    expect(realmPath).toBe(osuRealmPath);
  });
});

test("getRealmDBPath keeps accepting the legacy configDir argument", () => {
  withTempDir("osu-play-utils", (rootDir) => {
    const osuDataDir = path.join(rootDir, "osu");
    const osuRealmPath = path.join(osuDataDir, "client.realm");

    mkdirSync(osuDataDir, { recursive: true });
    writeFileSync(osuRealmPath, "realm-data");

    const realmPath = getRealmDBPath(path.join(rootDir, "legacy-config"), {
      osuDataDir,
    });

    expect(realmPath).toBe(osuRealmPath);
  });
});

test("getRealmDBPath returns null when the osu!lazer database is missing", () => {
  withTempDir("osu-play-utils", (rootDir) => {
    const realmPath = getRealmDBPath({
      osuDataDir: path.join(rootDir, "osu"),
    });

    expect(realmPath).toBeNull();
  });
});
