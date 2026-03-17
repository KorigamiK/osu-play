import path from "node:path";
import { writeFileSync } from "node:fs";

import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

import { buildPlaylist } from "../playlist/mod.js";
import { MpvPlayerBackend, PlaylistPlayerSession } from "../player/mod.js";
import { PlaylistPlayerScreen } from "../tui/player-screen.js";
import { getDefaultOsuDataDir, getRealmDBPath } from "../utils/mod.js";

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
      import("../lazer/mod.js"),
    ]);

    return {
      Realm,
      ...lazerModule,
    };
  } catch (error) {
    throw new Error(formatRealmLoadError(error), { cause: error });
  }
}

export function getArgs() {
  return yargs(hideBin(process.argv))
    .scriptName("osu-play")
    .usage(
      "Play music from your osu!lazer beatmaps in a minimal terminal player\nUsage: $0 [options]",
    )
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
    .alias("help", "h")
    .help()
    .parse();
}

async function createPlaylist(osuDataDir: string) {
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

    return buildPlaylist(getBeatmapSets(realm), osuDataDir);
  } finally {
    realm.close();
  }
}

async function runTuiPlayer(
  playlist: Awaited<ReturnType<typeof createPlaylist>>,
  loop: boolean,
) {
  const backend = new MpvPlayerBackend();
  const session = new PlaylistPlayerSession(playlist, backend, { loop });
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

  const playlist = await createPlaylist(argv.osuDataDir);

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

  await runTuiPlayer(playlist, argv.loop);
}
