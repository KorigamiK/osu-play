import Realm from "realm";
import type { PlaylistBeatmapSet } from "../playlist/mod.js";
import type { BeatmapSet } from "./schema/beatmapSet.js";
import { inspectLazerSchemaEntries } from "./compat.js";

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

export const getNamedFileHash = (fileName: string, beatmapSet: BeatmapSet) => {
  const files = beatmapSet.Files;
  for (const file of files) {
    if (file.Filename == fileName) return file.File.Hash;
  }
  return undefined;
};
