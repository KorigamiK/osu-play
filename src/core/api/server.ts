import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import type {
  CatalogAlbum,
  CatalogMedia,
  CatalogSong,
  MusicCatalog,
} from "./catalog.js";
import type { CatalogStore } from "../lazer/library.js";

const API_VERSION = "1.16.1";
const SERVER_VERSION = "1.4.0";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4533;

type ApiError = {
  code: number;
  message: string;
};

export type StartApiServerOptions = {
  catalogStore: CatalogStore;
  host?: string;
  port?: number;
};

export type RunningApiServer = {
  close(): Promise<void>;
  host: string;
  port: number;
  url: string;
};

function responseBase(status: "failed" | "ok") {
  return {
    openSubsonic: true,
    serverVersion: SERVER_VERSION,
    status,
    type: "osu-play",
    version: API_VERSION,
  };
}

function sendJson(
  response: ServerResponse,
  body: Record<string, unknown>,
  statusCode = 200,
) {
  const encoded = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(encoded),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(encoded);
}

function sendSuccess(response: ServerResponse, data: Record<string, unknown> = {}) {
  sendJson(response, {
    "subsonic-response": {
      ...responseBase("ok"),
      ...data,
    },
  });
}

function sendFailure(
  response: ServerResponse,
  error: ApiError,
  statusCode = 200,
) {
  sendJson(
    response,
    {
      "subsonic-response": {
        ...responseBase("failed"),
        error,
      },
    },
    statusCode,
  );
}

function requiredParameter(
  response: ServerResponse,
  params: URLSearchParams,
  name: string,
) {
  const value = params.get(name)?.trim();
  if (!value) {
    sendFailure(response, {
      code: 10,
      message: `Required parameter '${name}' is missing.`,
    });
    return null;
  }

  return value;
}

function hasValidCredentials(params: URLSearchParams) {
  const username = params.get("u")?.trim();
  const token = params.get("t")?.trim();
  const salt = params.get("s")?.trim();

  return Boolean(
    username
      && token
      && salt
      && /^[a-f0-9]{32}$/i.test(token)
      && params.get("f") === "json"
      && params.get("c")?.trim()
      && params.get("v")?.trim(),
  );
}

function parseNonNegativeInteger(
  value: string | null,
  fallback: number,
  maximum?: number,
) {
  if (value === null) {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  return maximum === undefined ? parsed : Math.min(parsed, maximum);
}

function albumPayload(album: CatalogAlbum) {
  return {
    artist: album.artist,
    ...(album.coverArt ? { coverArt: album.coverArt } : {}),
    id: album.id,
    name: album.name,
  };
}

function songPayload(song: CatalogSong) {
  return {
    album: song.album,
    albumId: song.albumId,
    artist: song.artist,
    ...(song.coverArt ? { coverArt: song.coverArt } : {}),
    ...(song.duration ? { duration: song.duration } : {}),
    id: song.id,
    title: song.title,
    track: song.track,
  };
}

function artistIndex(catalog: MusicCatalog) {
  const groups = new Map<string, Array<Record<string, unknown>>>();

  for (const artist of catalog.artists) {
    const firstCharacter = artist.name.trim().charAt(0).toUpperCase();
    const name = /^[A-Z]$/.test(firstCharacter) ? firstCharacter : "#";
    const group = groups.get(name) ?? [];
    group.push({
      ...(artist.coverArt ? { coverArt: artist.coverArt } : {}),
      id: artist.id,
      name: artist.name,
    });
    groups.set(name, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, artist]) => ({ artist, name }));
}

function contentType(fileName: string) {
  switch (path.extname(fileName).toLowerCase()) {
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
    case ".oga":
    case ".opus":
      return "audio/ogg";
    case ".png":
      return "image/png";
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function parseRange(rangeHeader: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      end: size - 1,
      start: Math.max(0, size - suffixLength),
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= size
  ) {
    return null;
  }

  return {
    end: Math.min(requestedEnd, size - 1),
    start,
  };
}

async function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  media: CatalogMedia,
  etag: string,
) {
  let file;
  try {
    file = await stat(media.path);
  } catch {
    sendFailure(
      response,
      {
        code: 70,
        message: "Requested media is no longer available.",
      },
      404,
    );
    return;
  }

  if (!file.isFile()) {
    sendFailure(
      response,
      {
        code: 70,
        message: "Requested media is not a file.",
      },
      404,
    );
    return;
  }

  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": contentType(media.fileName),
    ETag: `"${etag}"`,
  };
  const rangeHeader = request.headers.range;
  const range = rangeHeader ? parseRange(rangeHeader, file.size) : undefined;

  if (rangeHeader && !range) {
    response.writeHead(416, {
      ...commonHeaders,
      "Content-Range": `bytes */${file.size}`,
    });
    response.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const contentLength = Math.max(0, end - start + 1);
  response.writeHead(range ? 206 : 200, {
    ...commonHeaders,
    "Content-Length": contentLength,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}),
  });

  if (request.method === "HEAD" || file.size === 0) {
    response.end();
    return;
  }

  const stream = createReadStream(media.path, { end, start });
  const destroyStream = () => stream.destroy();
  response.once("close", destroyStream);
  stream.once("error", (error) => {
    response.destroy(error);
  });
  stream.once("close", () => {
    response.off("close", destroyStream);
  });
  stream.pipe(response);
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  catalogStore: CatalogStore,
) {
  const requestUrl = new URL(request.url ?? "/", `http://${DEFAULT_HOST}`);
  const match = /^\/rest\/([A-Za-z0-9]+)\.view$/.exec(requestUrl.pathname);
  if (!match) {
    sendFailure(
      response,
      {
        code: 0,
        message: "Unsupported API endpoint.",
      },
      404,
    );
    return;
  }

  const endpoint = match[1]!;
  const isMedia = endpoint === "stream" || endpoint === "getCoverArt";
  const allowedMethod =
    request.method === "GET" || (isMedia && request.method === "HEAD");
  if (!allowedMethod) {
    response.setHeader("Allow", isMedia ? "GET, HEAD" : "GET");
    sendFailure(
      response,
      {
        code: 0,
        message: "Unsupported HTTP method.",
      },
      405,
    );
    return;
  }

  if (!hasValidCredentials(requestUrl.searchParams)) {
    sendFailure(response, {
      code: 40,
      message: "Wrong username or password.",
    });
    return;
  }

  if (endpoint === "getArtists" || endpoint === "getAlbumList2") {
    const offset =
      endpoint === "getAlbumList2"
        ? parseNonNegativeInteger(requestUrl.searchParams.get("offset"), 0)
        : 0;
    if (offset === 0) {
      await catalogStore.refreshIfChanged();
    }
  }

  const catalog = catalogStore.getCatalog();

  switch (endpoint) {
    case "ping":
      sendSuccess(response);
      return;
    case "getArtists":
      sendSuccess(response, {
        artists: {
          index: artistIndex(catalog),
        },
      });
      return;
    case "getAlbumList2": {
      if (requestUrl.searchParams.get("type") !== "alphabeticalByName") {
        sendFailure(response, {
          code: 10,
          message: "Only type=alphabeticalByName is supported.",
        });
        return;
      }

      const offset = parseNonNegativeInteger(
        requestUrl.searchParams.get("offset"),
        0,
      );
      const size = parseNonNegativeInteger(
        requestUrl.searchParams.get("size"),
        10,
        500,
      );
      if (offset === null || size === null) {
        sendFailure(response, {
          code: 10,
          message: "Album offset and size must be non-negative integers.",
        });
        return;
      }

      sendSuccess(response, {
        albumList2: {
          album: catalog.albums.slice(offset, offset + size).map(albumPayload),
        },
      });
      return;
    }
    case "getAlbum": {
      const id = requiredParameter(response, requestUrl.searchParams, "id");
      if (!id) return;
      const album = catalog.albumsById.get(id);
      if (!album) {
        sendFailure(response, {
          code: 70,
          message: "Album not found.",
        });
        return;
      }

      sendSuccess(response, {
        album: {
          ...albumPayload(album),
          song: album.songs.map(songPayload),
        },
      });
      return;
    }
    case "stream": {
      const id = requiredParameter(response, requestUrl.searchParams, "id");
      if (!id) return;
      const song = catalog.songsById.get(id);
      if (!song) {
        sendFailure(
          response,
          {
            code: 70,
            message: "Song not found.",
          },
          404,
        );
        return;
      }

      await serveMedia(
        request,
        response,
        {
          fileName: song.fileName,
          path: song.path,
        },
        song.id,
      );
      return;
    }
    case "getCoverArt": {
      const id = requiredParameter(response, requestUrl.searchParams, "id");
      if (!id) return;
      const cover = catalog.coversById.get(id);
      if (!cover) {
        sendFailure(
          response,
          {
            code: 70,
            message: "Cover art not found.",
          },
          404,
        );
        return;
      }

      await serveMedia(request, response, cover, id);
      return;
    }
    case "getPlaylists":
      sendSuccess(response, {
        playlists: {
          playlist: [],
        },
      });
      return;
    case "getStarred2":
      sendSuccess(response, {
        starred2: {
          song: [],
        },
      });
      return;
    case "scrobble": {
      const id = requiredParameter(response, requestUrl.searchParams, "id");
      if (!id) return;
      if (!catalog.songsById.has(id)) {
        sendFailure(response, {
          code: 70,
          message: "Song not found.",
        });
        return;
      }
      sendSuccess(response);
      return;
    }
    case "getLyricsBySongId":
      sendSuccess(response, {
        lyricsList: {
          structuredLyrics: [],
        },
      });
      return;
    case "getLyrics":
      sendSuccess(response, {
        lyrics: {
          value: "",
        },
      });
      return;
    case "getPlaylist":
      sendFailure(response, {
        code: 70,
        message: "Playlist not found; osu-play API mode is read-only.",
      });
      return;
    case "createPlaylist":
    case "updatePlaylist":
    case "star":
    case "unstar":
      sendFailure(response, {
        code: 0,
        message: "This operation is not supported by read-only osu-play API mode.",
      });
      return;
    default:
      sendFailure(response, {
        code: 0,
        message: `Endpoint '${endpoint}.view' is not supported.`,
      });
  }
}

export async function startApiServer(
  options: StartApiServerOptions,
): Promise<RunningApiServer> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const server = createServer((request, response) => {
    void routeRequest(request, response, options.catalogStore).catch((error) => {
      if (!response.headersSent) {
        sendFailure(
          response,
          {
            code: 0,
            message: "Internal server error.",
          },
          500,
        );
      } else {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(requestedPort, host);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not determine the API server address.");
  }

  const port = address.port;

  return {
    async close() {
      if (!server.listening) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections();
      });
    },
    host,
    port,
    url: `http://${host}:${port}`,
  };
}
