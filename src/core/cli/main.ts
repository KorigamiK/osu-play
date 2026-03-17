import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

import {
  getDefaultOsuDataDir,
  getRealmDBPath,
} from "../utils/mod.js";
import { buildPlaylist } from "../playlist/mod.js";

const execFilePromise = promisify(execFile);

type BeatmapChoice = {
  title: string;
  path: string;
};

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
    throw new Error(
      [
        "Realm native bindings could not be loaded.",
        `Current Node runtime: ${process.version}.`,
        "If you installed dependencies on Node 22, switch to Node 20 LTS and run `npm rebuild realm --foreground-scripts`.",
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

export function getArgs() {
  return yargs(hideBin(process.argv))
    .scriptName("osu-play")
    .usage("Play music from your osu!lazer beatmaps from the terminal\nUsage: $0 [options]")
    .option("reload", {
      type: "boolean",
      default: false,
      alias: "r",
      describe: "Deprecated: ignored. osu-play now reads the live lazer database directly",
    })
    .option("exportPlaylist", {
      type: "string",
      describe: "Export playlist to a file",
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
      describe: "Loop the playlist on end",
    })
    .alias("help", "h")
    .help()
    .parse();
}

async function promptForBeatmap(uniqueBeatmaps: BeatmapChoice[]) {
  const { default: prompts } = await import("prompts");
  const response = await prompts<"beatmap">({
    type: "autocomplete",
    name: "beatmap",
    message: "Which map do you want to play:",
    choices: uniqueBeatmaps.map((beatmap, index) => ({
      title: beatmap.title,
      value: index,
    })),
  });

  return response.beatmap as number | undefined;
}

async function openBeatmap(filePath: string) {
  switch (process.platform) {
    case "darwin":
      await execFilePromise("open", [filePath]);
      return;
    case "win32":
      await execFilePromise("cmd", ["/c", "start", "", filePath]);
      return;
    default:
      await execFilePromise("xdg-open", [filePath]);
  }
}

export async function main() {
  const argv = await getArgs();
  console.log("[INFO] osu-play");

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

  if (argv.osuDataDir !== getDefaultOsuDataDir()) {
    console.log(`[INFO] Using osu!lazer data directory: ${argv.osuDataDir}`);
  }

  const realmDBPath = getRealmDBPath({
    osuDataDir: argv.osuDataDir,
  });

  if (!realmDBPath) {
    throw new Error("Realm DB not found");
  }

  const {
    Realm,
    LAST_STATIC_LAZER_SCHEMA_VERSION,
    formatLazerSchemaCompatibilityError,
    getBeatmapSets,
    getLazerDB,
    inspectLazerSchema,
  } = await loadRealmDependencies();

  Realm.flags.ALLOW_CLEAR_TEST_STATE = true;

  const realm = await getLazerDB(realmDBPath);

  try {
    const schemaReport = inspectLazerSchema(realm);
    console.log(`currentSchema: ${schemaReport.version}`);

    if (!schemaReport.compatible) {
      throw new Error(formatLazerSchemaCompatibilityError(schemaReport));
    }

    if (schemaReport.version !== LAST_STATIC_LAZER_SCHEMA_VERSION) {
      console.log(
        `[INFO] Detected osu!lazer schema version ${schemaReport.version}; continuing with reflected compatibility checks.`,
      );
    }

    const beatmapSets = getBeatmapSets(realm);
    const uniqueBeatmaps: BeatmapChoice[] = buildPlaylist(beatmapSets, argv.osuDataDir);

    console.log(`beatmap songs: ${uniqueBeatmaps.length}`);

    if (argv.exportPlaylist) {
      console.log(`[INFO] Exporting playlist to ${argv.exportPlaylist}`);
      const playlist = uniqueBeatmaps
        .map((beatmap) => beatmap.path)
        .join("\n");
      writeFileSync(argv.exportPlaylist, playlist);
      console.log(
        `[INFO] Done. Use something like \`mpv --playlist=${path.resolve(argv.exportPlaylist)}\` to play the playlist`,
      );
      return;
    }

    const selectedBeatmap = await promptForBeatmap(uniqueBeatmaps);
    if (selectedBeatmap === undefined) {
      console.log("[INFO] Cancelled");
      return;
    }

    console.log(`Selected: ${selectedBeatmap}`);

    for (let i = selectedBeatmap; i < uniqueBeatmaps.length; i += 1) {
      const beatmap = uniqueBeatmaps[i];

      if (!beatmap) {
        continue;
      }

      console.log(`Map: ${beatmap.title}`);
      if (beatmap.path && existsSync(beatmap.path)) {
        console.log(`Playing ${beatmap.title}`);
        await openBeatmap(beatmap.path);
      } else {
        console.log(`File does not exist: ${beatmap.path}`);
      }

      if (i < uniqueBeatmaps.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (argv.loop) {
        console.log("[INFO] Looping playlist");
        i = -1;
      } else {
        console.log("[INFO] Done. Use --loop to loop the playlist");
      }
    }
  } finally {
    realm.close();
  }
}
