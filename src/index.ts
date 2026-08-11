import {
  buildPlaylist as buildPlaylistImpl,
  formatTrackTitle as formatTrackTitleImpl,
} from "./core/playlist/mod.js";

export * from "./core/lazer/mod.js";
export * from "./core/lazer/schema/mod.js";
export * from "./core/utils/mod.js";

export function buildPlaylist(...args: Parameters<typeof buildPlaylistImpl>) {
  return buildPlaylistImpl(...args);
}

export function formatTrackTitle(...args: Parameters<typeof formatTrackTitleImpl>) {
  return formatTrackTitleImpl(...args);
}
