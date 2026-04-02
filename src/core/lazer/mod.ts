import Realm from "realm";
import type { PlaylistBeatmapSet, PlaylistTrack } from "../playlist/mod.js";
import type { BeatmapSet } from "./schema/beatmapSet.js";
import { inspectLazerSchemaEntries } from "./compat.js";
import { getRealmDBPath } from "../utils/mod.js";

export {
  Beatmap,
  BeatmapMetadata,
  BeatmapSet,
  RealmFile,
  RealmNamedFileUsage,
  RealmUser,
} from "./schema/mod.js";
export {
  formatLazerSchemaCompatibilityError,
  inspectLazerSchemaEntries,
  LAST_STATIC_LAZER_SCHEMA_VERSION,
} from "./compat.js";
export { hashedFilePath } from "../utils/mod.js";

type SchemaPropertyLike = {
  type?: string;
  objectType?: string;
};

type SchemaEntryLike = {
  name: string;
  properties: Record<string, SchemaPropertyLike>;
};

export function inspectLazerSchema(realm: Realm) {
  return inspectLazerSchemaEntries(
    realm.schema as unknown as SchemaEntryLike[],
    Realm.schemaVersion(realm.path),
  );
}

export const getLazerDB = async (realmDBPath: string) => {
  return Realm.open({
    path: realmDBPath,
    readOnly: true,
  });
};

export function getBeatmapSets(realm: Realm) {
  return realm.objects("BeatmapSet") as unknown as Iterable<PlaylistBeatmapSet>;
}

function queryBeatmapSet(
  realm: Realm,
  track: Pick<PlaylistTrack, "beatmapSetHash" | "beatmapSetId">,
) {
  const beatmapSets = realm.objects("BeatmapSet");

  if (track.beatmapSetId !== null && track.beatmapSetId !== undefined) {
    const byId =
      realm.objectForPrimaryKey(
        "BeatmapSet",
        track.beatmapSetId as Parameters<Realm["objectForPrimaryKey"]>[1],
      )
      ?? beatmapSets.filtered("ID == $0", track.beatmapSetId)[0];

    if (byId) {
      return byId;
    }
  }

  if (track.beatmapSetHash) {
    return beatmapSets.filtered("Hash == $0", track.beatmapSetHash)[0] ?? null;
  }

  return null;
}

export async function deleteBeatmapSet(
  track: Pick<PlaylistTrack, "beatmapSetHash" | "beatmapSetId" | "title">,
  osuDataDir: string,
) {
  const realmDBPath = getRealmDBPath({ osuDataDir });
  if (!realmDBPath) {
    throw new Error("Realm DB not found");
  }

  const realm = await Realm.open({ path: realmDBPath });

  try {
    let markedForDeletion = false;

    realm.write(() => {
      const beatmapSet = queryBeatmapSet(realm, track);
      if (!beatmapSet) {
        throw new Error(`Beatmap set for "${track.title}" no longer exists.`);
      }

      if (beatmapSet.Protected) {
        throw new Error(`"${track.title}" is protected and cannot be deleted.`);
      }

      if (beatmapSet.DeletePending) {
        return;
      }

      beatmapSet.DeletePending = true;
      markedForDeletion = true;
    });

    if (!markedForDeletion) {
      throw new Error(`"${track.title}" is already pending deletion.`);
    }
  } finally {
    realm.close();
  }
}

export const getNamedFileHash = (fileName: string, beatmapSet: BeatmapSet) => {
  const files = beatmapSet.Files;
  for (const file of files) {
    if (file.Filename == fileName) return file.File.Hash;
  }
  return undefined;
};
