import path from "node:path";
import { writeFileSync } from "node:fs";

import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

import { startApiServer } from "../api/server.js";
import {
  createLazerCatalogStore,
  deleteBeatmapSetFromLazer,
  loadPlaylistFromLazer,
} from "../lazer/library.js";
import type { PlaylistTrack } from "../playlist/mod.js";
import { MpvPlayerBackend, PlaylistPlayerSession } from "../player/mod.js";
import { PlaylistPlayerScreen } from "../tui/player-screen.js";
import { getDefaultOsuDataDir } from "../utils/mod.js";

export function getArgs() {
  return yargs(hideBin(process.argv))
    .scriptName("osu-play")
    .usage(
      "Play or serve music from your osu!lazer beatmaps\nUsage: $0 [options]",
    )
    .option("api", {
      type: "boolean",
      default: false,
      describe: "Run a localhost Subsonic API for music clients such as Kopuz",
    })
    .option("apiPort", {
      type: "number",
      default: 4533,
      describe: "Port for --api mode (binds to 127.0.0.1)",
    })
    .option("reload", {
      type: "boolean",
      default: false,
      alias: "r",
      describe: "Deprecated: ignored. osu-play now reads the live lazer database directly",
    })
    .option("exportPlaylist", {
      type: "string",
      describe: "Export playlist to a file instead of launching the player",
    })
    .option("osuDataDir", {
      type: "string",
      default: getDefaultOsuDataDir(),
      alias: "d",
      describe: "Osu!lazer data directory",
    })
    .option("configDir", {
      type: "string",
      alias: "c",
      describe: "Deprecated: ignored. osu-play no longer copies the lazer database",
    })
    .option("loop", {
      type: "boolean",
      default: false,
      alias: "l",
      describe: "Loop the playlist when playback reaches the end",
    })
    .option("shuffle", {
      type: "boolean",
      default: false,
      alias: "s",
      describe: "Play the playlist in shuffled order",
    })
    .check((argv) => {
      if (
        !Number.isInteger(argv.apiPort)
        || argv.apiPort < 1
        || argv.apiPort > 65_535
      ) {
        throw new Error("--apiPort must be an integer between 1 and 65535");
      }

      const conflictingMode = [
        argv.exportPlaylist ? "exportPlaylist" : null,
        argv.loop ? "loop" : null,
        argv.shuffle ? "shuffle" : null,
      ].find(Boolean);
      if (argv.api && conflictingMode) {
        throw new Error(
          `--api cannot be combined with --${conflictingMode}`,
        );
      }

      return true;
    })
    .alias("help", "h")
    .help()
    .parse();
}

async function deleteTrackFromCollection(
  track: PlaylistTrack,
  osuDataDir: string,
) {
  await deleteBeatmapSetFromLazer(track, osuDataDir);
}

async function runTuiPlayer(
  playlist: Awaited<ReturnType<typeof loadPlaylistFromLazer>>,
  osuDataDir: string,
  loop: boolean,
  shuffle: boolean,
) {
  const { revealFile } = await import("../utils/mod.js");
  const backend = new MpvPlayerBackend();
  const session = new PlaylistPlayerSession(playlist, backend, {
    deleteTrack: (track) => deleteTrackFromCollection(track, osuDataDir),
    loop,
    reloadPlaylist: () => loadPlaylistFromLazer(osuDataDir),
    revealTrack: (track) => revealFile(track.path),
    shuffle,
  });
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const screen = new PlaylistPlayerScreen(session, () => terminal.rows);

  let started = false;

  const exitPromise = new Promise<void>((resolve) => {
    screen.onQuit = () => resolve();
  });

  const unsubscribe = session.subscribe((snapshot) => {
    screen.setSnapshot(snapshot);
    if (started) {
      tui.requestRender();
    }
  });

  try {
    await session.start();

    tui.addChild(screen);
    tui.setFocus(screen);
    tui.start();
    started = true;

    await exitPromise;
  } finally {
    unsubscribe();

    if (started) {
      await terminal.drainInput().catch(() => {});
      tui.stop();
    }

    await session.dispose();
  }
}

async function runApiMode(osuDataDir: string, port: number) {
  const catalogStore = await createLazerCatalogStore(osuDataDir);
  const server = await startApiServer({
    catalogStore,
    port,
  });

  console.log(`[INFO] osu-play API listening at ${server.url}`);
  console.log(
    "[INFO] In Kopuz, add a Custom server with this URL and any non-empty username/password.",
  );
  console.log("[INFO] Press Ctrl+C to stop.");

  let resolveShutdown: (() => void) | undefined;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  const handleSignal = () => resolveShutdown?.();

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await shutdown;
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    await server.close();
  }
}

export async function main() {
  const argv = await getArgs();

  if (argv.reload) {
    console.log(
      "[INFO] `--reload` is deprecated and ignored because osu-play reads osu!lazer's live Realm DB directly.",
    );
  }

  if (argv.configDir) {
    console.log(
      "[INFO] `--configDir` is deprecated and ignored because osu-play no longer copies the Realm DB.",
    );
  }

  if (argv.api) {
    await runApiMode(argv.osuDataDir, argv.apiPort);
    return;
  }

  const playlist = await loadPlaylistFromLazer(argv.osuDataDir);

  if (argv.exportPlaylist) {
    const playlistContents = playlist.map((track) => track.path).join("\n");
    writeFileSync(argv.exportPlaylist, playlistContents);
    console.log(
      `[INFO] Exported ${playlist.length} tracks to ${argv.exportPlaylist}.`,
    );
    console.log(
      `[INFO] Use something like \`mpv --playlist=${path.resolve(argv.exportPlaylist)}\` to play the playlist.`,
    );
    return;
  }

  await runTuiPlayer(playlist, argv.osuDataDir, argv.loop, argv.shuffle);
}
