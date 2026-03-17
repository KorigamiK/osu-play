import { describe, expect, test } from "bun:test";

import {
  buildPlaylist,
  formatTrackTitle,
  getNamedFileHash,
} from "../src/core/playlist/mod.ts";

function createBeatmapSet({ files, beatmaps }) {
  return {
    Files: files,
    Beatmaps: beatmaps.map((metadata) => ({
      Metadata: metadata,
    })),
  };
}

describe("playlist builder", () => {
  test("deduplicates tracks by resolved file hash", () => {
    const playlist = buildPlaylist(
      [
        createBeatmapSet({
          files: [
            { Filename: "audio.mp3", File: { Hash: "abc123" } },
            { Filename: "duplicate.mp3", File: { Hash: "abc123" } },
          ],
          beatmaps: [
            {
              AudioFile: "audio.mp3",
              Title: "Song",
              Artist: "Artist",
              TitleUnicode: "Song",
              ArtistUnicode: "Artist",
            },
            {
              AudioFile: "duplicate.mp3",
              Title: "Song",
              Artist: "Artist",
              TitleUnicode: "Song",
              ArtistUnicode: "Artist",
            },
          ],
        }),
      ],
      "/osu",
    );

    expect(playlist).toHaveLength(1);
    expect(playlist[0]).toEqual({
      hash: "abc123",
      path: "/osu/files/a/ab/abc123",
      title: "Song - Artist",
    });
  });

  test("formats unicode metadata without repeating identical values", () => {
    const title = formatTrackTitle({
      Title: "Snow Drive",
      Artist: "Omega",
      TitleUnicode: "Snow Drive",
      ArtistUnicode: "Omega",
    });

    expect(title).toBe("Snow Drive - Omega");
  });

  test("looks up hashes by audio file name", () => {
    const beatmapSet = createBeatmapSet({
      files: [{ Filename: "track.ogg", File: { Hash: "hash-1" } }],
      beatmaps: [],
    });

    expect(getNamedFileHash("track.ogg", beatmapSet)).toBe("hash-1");
    expect(getNamedFileHash("missing.ogg", beatmapSet)).toBeUndefined();
  });
});
