import { describe, expect, test } from "bun:test";
import path from "node:path";

import { buildMusicCatalog } from "../src/core/api/catalog.ts";

function beatmapSet({
  backgroundHash = "cover-hash",
  deletePending = false,
  id = "set-id",
  length = 125_400,
  songHash = "audio-hash",
  title = "Song",
}) {
  return {
    Beatmaps: [
      {
        Length: length,
        Metadata: {
          Artist: "Artist",
          ArtistUnicode: "アーティスト",
          AudioFile: "audio.mp3",
          BackgroundFile: "background.jpg",
          Title: title,
          TitleUnicode: "曲",
        },
      },
      {
        Length: length + 600,
        Metadata: {
          Artist: "Artist",
          ArtistUnicode: "アーティスト",
          AudioFile: "audio.mp3",
          BackgroundFile: "background.jpg",
          Title: title,
          TitleUnicode: "曲",
        },
      },
    ],
    DeletePending: deletePending,
    Files: [
      { Filename: "audio.mp3", File: { Hash: songHash } },
      { Filename: "background.jpg", File: { Hash: backgroundHash } },
    ],
    Hash: `${id}-hash`,
    ID: id,
  };
}

describe("API music catalog", () => {
  test("projects stable albums, songs, artists, durations, and cover art", () => {
    const first = buildMusicCatalog([beatmapSet({})], "/osu");
    const second = buildMusicCatalog([beatmapSet({})], "/osu");

    expect(first.albums).toHaveLength(1);
    expect(first.albums[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(first.albums[0].id).not.toContain(":");
    expect(first.albums[0].id).toBe(second.albums[0].id);
    expect(first.albums[0]).toMatchObject({
      artist: "Artist / アーティスト",
      coverArt: "cover-hash",
      name: "Song / 曲",
    });
    expect(first.albums[0].songs).toEqual([
      {
        album: "Song / 曲",
        albumId: first.albums[0].id,
        artist: "Artist / アーティスト",
        coverArt: "cover-hash",
        duration: 126,
        fileName: "audio.mp3",
        id: "audio-hash",
        path: path.join("/osu", "files", "a", "au", "audio-hash"),
        title: "Song / 曲",
        track: 1,
      },
    ]);
    expect(first.artists).toEqual([
      {
        coverArt: "cover-hash",
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        name: "Artist / アーティスト",
      },
    ]);
    expect(first.coversById.get("cover-hash")).toEqual({
      fileName: "background.jpg",
      path: path.join("/osu", "files", "c", "co", "cover-hash"),
    });
  });

  test("deduplicates audio globally and skips empty or deleted albums", () => {
    const catalog = buildMusicCatalog(
      [
        beatmapSet({ id: "z-set", songHash: "shared-hash", title: "Later" }),
        beatmapSet({ id: "a-set", songHash: "shared-hash", title: "First" }),
        beatmapSet({ deletePending: true, id: "deleted", songHash: "deleted-hash" }),
      ],
      "/osu",
    );

    expect(catalog.albums).toHaveLength(1);
    expect(catalog.albums[0].name).toBe("First / 曲");
    expect(catalog.songsById.has("shared-hash")).toBe(true);
    expect(catalog.songsById.has("deleted-hash")).toBe(false);
  });

  test("omits unavailable optional metadata rather than inventing it", () => {
    const catalog = buildMusicCatalog(
      [
        {
          Beatmaps: [
            {
              Metadata: {
                AudioFile: "track.ogg",
              },
            },
          ],
          Files: [{ Filename: "track.ogg", File: { Hash: "track-hash" } }],
          ID: "minimal",
        },
      ],
      "/osu",
    );

    expect(catalog.albums[0]).toMatchObject({
      artist: "Unknown Artist",
      name: "Unknown Title",
    });
    expect(catalog.albums[0].coverArt).toBeUndefined();
    expect(catalog.albums[0].songs[0].duration).toBeUndefined();
  });
});
