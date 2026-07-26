import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildMusicCatalog } from "../src/core/api/catalog.ts";
import { startApiServer } from "../src/core/api/server.ts";
import { hashedFilePath } from "../src/core/utils/mod.ts";

const auth = {
  c: "kopuz",
  f: "json",
  s: "abcdefghijklmnop",
  t: "0".repeat(32),
  u: "listener",
  v: "1.16.1",
};

function apiUrl(baseUrl, endpoint, params = {}) {
  const url = new URL(`/rest/${endpoint}.view`, baseUrl);
  for (const [key, value] of Object.entries({ ...auth, ...params })) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

describe("Kopuz-compatible API server", () => {
  let albumId;
  let baseUrl;
  let refreshCount = 0;
  let running;
  let tempDir;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "osu-play-api-test-"));
    const audioHash = "abc123";
    const coverHash = "def456";
    const audioPath = hashedFilePath(audioHash, tempDir);
    const coverPath = hashedFilePath(coverHash, tempDir);
    mkdirSync(path.dirname(audioPath), { recursive: true });
    mkdirSync(path.dirname(coverPath), { recursive: true });
    writeFileSync(audioPath, Buffer.from("0123456789"));
    writeFileSync(coverPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const catalog = buildMusicCatalog(
      [
        {
          Beatmaps: [
            {
              Length: 91_000,
              Metadata: {
                Artist: "API Artist",
                AudioFile: "song.mp3",
                BackgroundFile: "cover.jpg",
                Title: "API Song",
              },
            },
          ],
          Files: [
            { Filename: "song.mp3", File: { Hash: audioHash } },
            { Filename: "cover.jpg", File: { Hash: coverHash } },
          ],
          ID: "api-set",
        },
      ],
      tempDir,
    );
    albumId = catalog.albums[0].id;

    running = await startApiServer({
      catalogStore: {
        getCatalog: () => catalog,
        refreshIfChanged: async () => {
          refreshCount += 1;
          return catalog;
        },
      },
      port: 0,
    });
    baseUrl = running.url;
  });

  afterAll(async () => {
    await running?.close();
    rmSync(tempDir, { force: true, recursive: true });
  });

  test("authenticates the Kopuz query shape and reports standard envelopes", async () => {
    const pingResponse = await fetch(apiUrl(baseUrl, "ping"));
    const ping = await pingResponse.json();

    expect(pingResponse.status).toBe(200);
    expect(ping["subsonic-response"]).toMatchObject({
      openSubsonic: true,
      serverVersion: "1.4.0",
      status: "ok",
      type: "osu-play",
      version: "1.16.1",
    });

    const badAuthUrl = apiUrl(baseUrl, "ping");
    badAuthUrl.searchParams.set("t", "not-a-token");
    const badAuth = await (await fetch(badAuthUrl)).json();
    expect(badAuth["subsonic-response"]).toMatchObject({
      error: {
        code: 40,
        message: "Wrong username or password.",
      },
      status: "failed",
    });
  });

  test("serves the library lifecycle Kopuz uses", async () => {
    const artists = await (await fetch(apiUrl(baseUrl, "getArtists"))).json();
    expect(artists["subsonic-response"].artists.index[0].artist[0]).toMatchObject({
      coverArt: "def456",
      name: "API Artist",
    });

    const albums = await (
      await fetch(
        apiUrl(baseUrl, "getAlbumList2", {
          offset: 0,
          size: 250,
          type: "alphabeticalByName",
        }),
      )
    ).json();
    expect(albums["subsonic-response"].albumList2.album).toEqual([
      {
        artist: "API Artist",
        coverArt: "def456",
        id: albumId,
        name: "API Song",
      },
    ]);
    expect(refreshCount).toBeGreaterThanOrEqual(2);

    const album = await (
      await fetch(apiUrl(baseUrl, "getAlbum", { id: albumId }))
    ).json();
    expect(album["subsonic-response"].album.song).toEqual([
      {
        album: "API Song",
        albumId,
        artist: "API Artist",
        coverArt: "def456",
        duration: 91,
        id: "abc123",
        title: "API Song",
        track: 1,
      },
    ]);
  });

  test("streams audio and artwork with full, HEAD, and range responses", async () => {
    const streamUrl = apiUrl(baseUrl, "stream", {
      format: "mp3",
      id: "abc123",
      maxBitRate: 128,
    });
    const full = await fetch(streamUrl);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(full.headers.get("content-length")).toBe("10");
    expect(await full.text()).toBe("0123456789");

    const head = await fetch(streamUrl, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");

    const range = await fetch(streamUrl, {
      headers: { Range: "bytes=2-5" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await range.text()).toBe("2345");

    const invalidRange = await fetch(streamUrl, {
      headers: { Range: "bytes=20-30" },
    });
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get("content-range")).toBe("bytes */10");

    const cover = await fetch(apiUrl(baseUrl, "getCoverArt", { id: "def456" }));
    expect(cover.status).toBe(200);
    expect(cover.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await cover.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    );
  });

  test("keeps ancillary reads harmless and rejects remote mutations honestly", async () => {
    const playlists = await (
      await fetch(apiUrl(baseUrl, "getPlaylists"))
    ).json();
    expect(playlists["subsonic-response"].playlists.playlist).toEqual([]);

    const starred = await (await fetch(apiUrl(baseUrl, "getStarred2"))).json();
    expect(starred["subsonic-response"].starred2.song).toEqual([]);

    const scrobble = await (
      await fetch(apiUrl(baseUrl, "scrobble", { id: "abc123", submission: true }))
    ).json();
    expect(scrobble["subsonic-response"].status).toBe("ok");

    const star = await (
      await fetch(apiUrl(baseUrl, "star", { id: "abc123" }))
    ).json();
    expect(star["subsonic-response"]).toMatchObject({
      error: {
        code: 0,
      },
      status: "failed",
    });

    const lyrics = await (
      await fetch(apiUrl(baseUrl, "getLyricsBySongId", { id: "abc123" }))
    ).json();
    expect(lyrics["subsonic-response"].lyricsList.structuredLyrics).toEqual([]);
  });

  test("unknown media IDs cannot become filesystem paths", async () => {
    const response = await fetch(
      apiUrl(baseUrl, "stream", { id: "../../../../etc/passwd" }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body["subsonic-response"].error.code).toBe(70);
  });
});
