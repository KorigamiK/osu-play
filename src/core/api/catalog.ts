import { createHash } from "node:crypto";

import { hashedFilePath } from "../utils/mod.js";

export type CatalogBeatmapMetadata = {
  Artist?: string | null;
  ArtistUnicode?: string | null;
  AudioFile?: string | null;
  BackgroundFile?: string | null;
  Title?: string | null;
  TitleUnicode?: string | null;
};

export type CatalogBeatmap = {
  Length?: number | null;
  Metadata: CatalogBeatmapMetadata;
};

export type CatalogBeatmapSet = {
  Beatmaps: Iterable<CatalogBeatmap>;
  DeletePending?: boolean;
  Files: Iterable<{
    File?: {
      Hash?: string | null;
    } | null;
    Filename?: string | null;
  }>;
  Hash?: string | null;
  ID?: unknown;
};

export type CatalogMedia = {
  fileName: string;
  path: string;
};

export type CatalogSong = {
  album: string;
  albumId: string;
  artist: string;
  coverArt?: string;
  duration?: number;
  fileName: string;
  id: string;
  path: string;
  title: string;
  track: number;
};

export type CatalogAlbum = {
  artist: string;
  coverArt?: string;
  id: string;
  name: string;
  songs: CatalogSong[];
};

export type CatalogArtist = {
  coverArt?: string;
  id: string;
  name: string;
};

export type MusicCatalog = {
  albums: CatalogAlbum[];
  albumsById: Map<string, CatalogAlbum>;
  artists: CatalogArtist[];
  coversById: Map<string, CatalogMedia>;
  songsById: Map<string, CatalogSong>;
};

type PendingSong = {
  artist: string;
  coverArt?: string;
  durationMs: number;
  fileName: string;
  hash: string;
  title: string;
};

function stableId(kind: string, value: string) {
  return createHash("sha256").update(`${kind}\0${value}`).digest("hex");
}

function normalizedParts(parts: Array<string | null | undefined>) {
  return [...new Set(parts.map((part) => part?.trim()).filter(Boolean))] as string[];
}

function formatMetadataText(
  primary: string | null | undefined,
  unicode: string | null | undefined,
  fallback: string,
) {
  return normalizedParts([primary, unicode]).join(" / ") || fallback;
}

function getNamedFile(
  fileName: string | null | undefined,
  beatmapSet: CatalogBeatmapSet,
) {
  if (!fileName) {
    return null;
  }

  for (const file of beatmapSet.Files) {
    if (file.Filename === fileName && file.File?.Hash) {
      return {
        fileName,
        hash: file.File.Hash,
      };
    }
  }

  return null;
}

function beatmapSetKey(beatmapSet: CatalogBeatmapSet) {
  return String(beatmapSet.ID ?? beatmapSet.Hash ?? "");
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    usage: "sort",
  });
}

export function emptyMusicCatalog(): MusicCatalog {
  return {
    albums: [],
    albumsById: new Map(),
    artists: [],
    coversById: new Map(),
    songsById: new Map(),
  };
}

export function buildMusicCatalog(
  beatmapSets: Iterable<CatalogBeatmapSet>,
  osuDataDir: string,
): MusicCatalog {
  const albums: CatalogAlbum[] = [];
  const coversById = new Map<string, CatalogMedia>();
  const seenAudioHashes = new Set<string>();

  const sortedSets = [...beatmapSets]
    .filter((beatmapSet) => !beatmapSet.DeletePending)
    .sort((left, right) => compareText(beatmapSetKey(left), beatmapSetKey(right)));

  for (const beatmapSet of sortedSets) {
    const pendingByHash = new Map<string, PendingSong>();
    let albumCoverArt: string | undefined;

    for (const beatmap of beatmapSet.Beatmaps) {
      const metadata = beatmap.Metadata;
      const audio = getNamedFile(metadata.AudioFile, beatmapSet);
      if (!audio) {
        continue;
      }

      const background = getNamedFile(metadata.BackgroundFile, beatmapSet);
      if (background) {
        coversById.set(background.hash, {
          fileName: background.fileName,
          path: hashedFilePath(background.hash, osuDataDir),
        });
        albumCoverArt ??= background.hash;
      }

      const durationMs = Math.max(0, beatmap.Length ?? 0);
      const existing = pendingByHash.get(audio.hash);
      if (existing) {
        existing.durationMs = Math.max(existing.durationMs, durationMs);
        existing.coverArt ??= background?.hash;
        continue;
      }

      pendingByHash.set(audio.hash, {
        artist: formatMetadataText(
          metadata.Artist,
          metadata.ArtistUnicode,
          "Unknown Artist",
        ),
        coverArt: background?.hash,
        durationMs,
        fileName: audio.fileName,
        hash: audio.hash,
        title: formatMetadataText(
          metadata.Title,
          metadata.TitleUnicode,
          "Unknown Title",
        ),
      });
    }

    const retained = [...pendingByHash.values()].filter(
      (song) => !seenAudioHashes.has(song.hash),
    );
    if (retained.length === 0) {
      continue;
    }

    for (const song of retained) {
      seenAudioHashes.add(song.hash);
    }

    const firstSong = retained[0]!;
    const setKey = beatmapSetKey(beatmapSet) || firstSong.hash;
    const albumId = stableId("album", setKey);
    const albumName = firstSong.title;
    const albumArtist = firstSong.artist;
    const coverArt = albumCoverArt ?? firstSong.coverArt;
    const songs = retained.map<CatalogSong>((song, index) => {
      const duration = Math.round(song.durationMs / 1000);

      return {
        album: albumName,
        albumId,
        artist: song.artist,
        ...(coverArt ? { coverArt } : {}),
        ...(duration > 0 ? { duration } : {}),
        fileName: song.fileName,
        id: song.hash,
        path: hashedFilePath(song.hash, osuDataDir),
        title: song.title,
        track: index + 1,
      };
    });

    albums.push({
      artist: albumArtist,
      ...(coverArt ? { coverArt } : {}),
      id: albumId,
      name: albumName,
      songs,
    });
  }

  albums.sort(
    (left, right) => compareText(left.name, right.name) || left.id.localeCompare(right.id),
  );

  const albumsById = new Map(albums.map((album) => [album.id, album]));
  const songsById = new Map(
    albums.flatMap((album) => album.songs.map((song) => [song.id, song] as const)),
  );
  const artistsByName = new Map<string, CatalogArtist>();

  for (const album of albums) {
    const normalizedName = album.artist.trim().toLocaleLowerCase();
    const existing = artistsByName.get(normalizedName);
    if (existing) {
      existing.coverArt ??= album.coverArt;
      continue;
    }

    artistsByName.set(normalizedName, {
      ...(album.coverArt ? { coverArt: album.coverArt } : {}),
      id: stableId("artist", normalizedName),
      name: album.artist,
    });
  }

  const artists = [...artistsByName.values()].sort(
    (left, right) => compareText(left.name, right.name) || left.id.localeCompare(right.id),
  );

  return {
    albums,
    albumsById,
    artists,
    coversById,
    songsById,
  };
}
