import { expect, test } from "bun:test";

import { withTempDir } from "./support/temp-dir.mjs";

const decoder = new TextDecoder();

test("deletes and restores beatmap sets transactionally", () => {
  withTempDir("osu-play-library-editor", (osuDataDir) => {
    const script = `
      import assert from "node:assert/strict";
      import path from "node:path";
      import Realm from "realm";
      import { deleteBeatmapSet, restoreBeatmapSet } from "./dist/index.js";

      const osuDataDir = process.env.TEST_OSU_DATA_DIR;
      const realmPath = path.join(osuDataDir, "client.realm");
      const schema = [{
        name: "BeatmapSet",
        primaryKey: "ID",
        properties: {
          ID: "uuid",
          Hash: "string?",
          DeletePending: { type: "bool", default: false },
          Protected: { type: "bool", default: false },
        },
      }];
      const editableId = new Realm.BSON.UUID();
      const protectedId = new Realm.BSON.UUID();
      let realm = await Realm.open({ path: realmPath, schema });
      realm.write(() => {
        realm.create("BeatmapSet", {
          ID: editableId,
          Hash: "editable-hash",
          DeletePending: false,
          Protected: false,
        });
        realm.create("BeatmapSet", {
          ID: protectedId,
          Hash: "protected-hash",
          DeletePending: false,
          Protected: true,
        });
      });
      realm.close();

      const editable = {
        beatmapSetHash: "editable-hash",
        beatmapSetId: editableId,
        title: "Editable",
      };
      await deleteBeatmapSet(editable, osuDataDir);

      realm = await Realm.open({ path: realmPath });
      assert.equal(realm.objectForPrimaryKey("BeatmapSet", editableId).DeletePending, true);
      realm.close();

      await restoreBeatmapSet(editable, osuDataDir);
      realm = await Realm.open({ path: realmPath });
      assert.equal(realm.objectForPrimaryKey("BeatmapSet", editableId).DeletePending, false);
      realm.close();

      await assert.rejects(
        deleteBeatmapSet({
          beatmapSetHash: "protected-hash",
          beatmapSetId: protectedId,
          title: "Protected",
        }, osuDataDir),
        /protected and cannot be deleted/,
      );
      realm = await Realm.open({ path: realmPath });
      assert.equal(realm.objectForPrimaryKey("BeatmapSet", protectedId).DeletePending, false);
      realm.close();

      if (typeof Realm.shutdown === "function") Realm.shutdown();
    `;
    const result = Bun.spawnSync(
      ["node", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEST_OSU_DATA_DIR: osuDataDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(decoder.decode(result.stderr)).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
