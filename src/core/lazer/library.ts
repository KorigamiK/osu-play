import { stat } from "node:fs/promises";

import {
  buildMusicCatalog,
  type MusicCatalog,
} from "../api/catalog.js";
import { buildPlaylist, type PlaylistTrack } from "../playlist/mod.js";
import { getRealmDBPath } from "../utils/mod.js";

function formatRealmLoadError(error: unknown) {
  return [
    "Realm native bindings could not be loaded.",
    `Current Node runtime: ${process.version}.`,
    "To repair Realm bindings in this project, run `bun run repair:realm` (or `bun run setup` to reinstall dependencies).",
    "If you installed dependencies on Node 22, switch to Node 20 LTS and rerun the repair command.",
    `Original error: ${error instanceof Error ? error.message : String(error)}`,
  ].join("\n");
}

async function loadRealmDependencies() {
  try {
    const [{ default: Realm }, lazerModule] = await Promise.all([
      import("realm"),
      import("./mod.js"),
    ]);

    return {
      Realm,
      ...lazerModule,
    };
  } catch (error) {
    throw new Error(formatRealmLoadError(error), { cause: error });
  }
}

async function projectLazerLibrary<T>(
  osuDataDir: string,
  projector: (beatmapSets: Iterable<any>) => T,
) {
  const realmDBPath = getRealmDBPath({ osuDataDir });
  if (!realmDBPath) {
    throw new Error("Realm DB not found");
  }

  const {
    Realm,
    formatLazerSchemaCompatibilityError,
    getBeatmapSets,
    getLazerDB,
    inspectLazerSchema,
  } = await loadRealmDependencies();

  Realm.flags.ALLOW_CLEAR_TEST_STATE = true;
  const realm = await getLazerDB(realmDBPath);

  try {
    const schemaReport = inspectLazerSchema(realm);
    if (!schemaReport.compatible) {
      throw new Error(formatLazerSchemaCompatibilityError(schemaReport));
    }

    return projector(getBeatmapSets(realm));
  } finally {
    realm.close();
  }
}

export function loadPlaylistFromLazer(osuDataDir: string) {
  return projectLazerLibrary<PlaylistTrack[]>(osuDataDir, (beatmapSets) =>
    buildPlaylist(beatmapSets, osuDataDir),
  );
}

export function loadMusicCatalogFromLazer(osuDataDir: string) {
  return projectLazerLibrary<MusicCatalog>(osuDataDir, (beatmapSets) =>
    buildMusicCatalog(beatmapSets, osuDataDir),
  );
}

export async function deleteBeatmapSetFromLazer(
  track: Pick<PlaylistTrack, "beatmapSetHash" | "beatmapSetId" | "title">,
  osuDataDir: string,
) {
  const { deleteBeatmapSet } = await loadRealmDependencies();
  await deleteBeatmapSet(track, osuDataDir);
}

export async function restoreBeatmapSetInLazer(
  track: Pick<PlaylistTrack, "beatmapSetHash" | "beatmapSetId" | "title">,
  osuDataDir: string,
) {
  const { restoreBeatmapSet } = await loadRealmDependencies();
  await restoreBeatmapSet(track, osuDataDir);
}

export type CatalogStore = {
  getCatalog(): MusicCatalog;
  refreshIfChanged(): Promise<MusicCatalog>;
};

type RefreshingCatalogStoreOptions = {
  getSignature: () => Promise<string>;
  loadCatalog: () => Promise<MusicCatalog>;
  onRefreshError?: (error: unknown) => void;
};

export async function createRefreshingCatalogStore(
  options: RefreshingCatalogStoreOptions,
): Promise<CatalogStore> {
  let catalog = await options.loadCatalog();
  let signature = await options.getSignature();
  let refreshPromise: Promise<MusicCatalog> | null = null;

  return {
    getCatalog() {
      return catalog;
    },
    async refreshIfChanged() {
      if (refreshPromise) {
        return refreshPromise;
      }

      refreshPromise = (async () => {
        try {
          const nextSignature = await options.getSignature();
          if (nextSignature === signature) {
            return catalog;
          }

          const nextCatalog = await options.loadCatalog();
          catalog = nextCatalog;
          signature = nextSignature;
        } catch (error) {
          options.onRefreshError?.(error);
        }

        return catalog;
      })();

      try {
        return await refreshPromise;
      } finally {
        refreshPromise = null;
      }
    },
  };
}

export async function createLazerCatalogStore(
  osuDataDir: string,
  onRefreshError: (error: unknown) => void = (error) => {
    console.warn(
      `[WARN] Could not refresh the osu!lazer catalog; continuing with the last good snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  },
) {
  const realmDBPath = getRealmDBPath({ osuDataDir });
  if (!realmDBPath) {
    throw new Error("Realm DB not found");
  }

  return createRefreshingCatalogStore({
    async getSignature() {
      const file = await stat(realmDBPath);
      return `${file.mtimeMs}:${file.size}`;
    },
    loadCatalog: () => loadMusicCatalogFromLazer(osuDataDir),
    onRefreshError,
  });
}
