import { hashedFilePath } from "../utils/mod.js";

export type PlaylistBeatmapMetadata = {
  AudioFile?: string | null;
  Title?: string | null;
  Artist?: string | null;
  TitleUnicode?: string | null;
  ArtistUnicode?: string | null;
};

export type PlaylistBeatmap = {
  Metadata: PlaylistBeatmapMetadata;
};

export type PlaylistFile = {
  Filename?: string | null;
  File?: {
    Hash?: string | null;
  } | null;
};

export type PlaylistBeatmapSet = {
  Beatmaps: Iterable<PlaylistBeatmap>;
  Files: Iterable<PlaylistFile>;
};

export type PlaylistTrack = {
  hash: string;
  path: string;
  title: string;
};

function uniqueParts(parts: Array<string | null | undefined>) {
  return [...new Set(parts.map((part) => part?.trim()).filter(Boolean))];
}

export function formatTrackTitle(metadata: PlaylistBeatmapMetadata) {
  const title = uniqueParts([metadata.Title, metadata.TitleUnicode]).join(" / ");
  const artist = uniqueParts([metadata.Artist, metadata.ArtistUnicode]).join(" / ");

  return `${title || "Unknown Title"} - ${artist || "Unknown Artist"}`;
}

export function getNamedFileHash(fileName: string, beatmapSet: PlaylistBeatmapSet) {
  for (const file of beatmapSet.Files) {
    if (file.Filename === fileName && file.File?.Hash) {
      return file.File.Hash;
    }
  }

  return undefined;
}

export function buildPlaylist(
  beatmapSets: Iterable<PlaylistBeatmapSet>,
  osuDataDir: string,
) {
  const seenHashes = new Set<string>();
  const playlist: PlaylistTrack[] = [];

  for (const beatmapSet of beatmapSets) {
    for (const beatmap of beatmapSet.Beatmaps) {
      const hash = getNamedFileHash(beatmap.Metadata.AudioFile ?? "", beatmapSet);
      if (!hash || seenHashes.has(hash)) {
        continue;
      }

      seenHashes.add(hash);
      playlist.push({
        hash,
        path: hashedFilePath(hash, osuDataDir),
        title: formatTrackTitle(beatmap.Metadata),
      });
    }
  }

  return playlist;
}
