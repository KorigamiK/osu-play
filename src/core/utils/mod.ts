import path from "node:path";
import { existsSync } from "node:fs";

export function getDataDir(): string | undefined {
  switch (process.platform) {
    case "linux":
    case "openbsd":
    case "freebsd": {
      const xdg = process.env.XDG_DATA_HOME;
      if (xdg) return xdg;

      const home = process.env.HOME;
      if (home) return path.join(home, ".local", "share");
      break;
    }

    case "darwin": {
      const home = process.env.HOME;
      if (home) return path.join(home, "Library", "Application Support");
      break;
    }

    case "win32":
      return process.env.LOCALAPPDATA ?? undefined;
  }

  return undefined;
}

export function getConfigDir(): string | undefined {
  switch (process.platform) {
    case "openbsd":
    case "freebsd":
    case "linux": {
      const xdg = process.env.XDG_CONFIG_HOME;
      if (xdg) return xdg;

      const home = process.env.HOME;
      if (home) return path.join(home, ".config");
      break;
    }

    case "darwin": {
      const home = process.env.HOME;
      if (home) return path.join(home, "Library", "Preferences");
      break;
    }

    case "win32":
      return process.env.APPDATA ?? undefined;
  }

  return undefined;
}

export function getDefaultOsuDataDir() {
  return path.join(getDataDir() ?? ".", "osu");
}

export function getDefaultConfigPath(appName: string = "osu-play") {
  return path.join(getConfigDir() ?? ".", appName);
}

export function hashedFilePath(
  hash: string,
  osuDataDir: string = getDefaultOsuDataDir(),
) {
  return path.join(
    osuDataDir,
    "files",
    hash.slice(0, 1),
    hash.slice(0, 2),
    hash,
  );
}

type RealmPathOptions = {
  osuDataDir?: string;
};

/**
 * Returns osu!lazer's live Realm DB path directly.
 * The legacy `appConfigDir` positional argument is accepted for backwards
 * compatibility but no longer used.
 */
export function getRealmDBPath(options?: RealmPathOptions): string | null;
export function getRealmDBPath(
  legacyAppConfigDir: string,
  options?: RealmPathOptions,
): string | null;
export function getRealmDBPath(
  legacyAppConfigDirOrOptions: string | RealmPathOptions = {},
  maybeOptions: RealmPathOptions = {},
) {
  const options =
    typeof legacyAppConfigDirOrOptions === "string"
      ? maybeOptions
      : legacyAppConfigDirOrOptions;
  const osuDataDir = options.osuDataDir ?? getDefaultOsuDataDir();
  const osuDBPath = path.join(osuDataDir, "client.realm");

  if (!existsSync(osuDBPath)) {
    console.log(`[getRealmDBPath]: ${osuDBPath} not found`);
    return null;
  }

  return osuDBPath;
}
