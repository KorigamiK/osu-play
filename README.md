<h1 align="center">
	<br>
  osu!play
	<br>

[![NPM version](https://img.shields.io/npm/v/osu-play.svg?style=flat)](https://npmjs.org/package/osu-play)
[![Downloads](https://badgen.net/npm/dt/osu-play)](https://www.npmjs.com/package/osu-play)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE)

</h1>

> Turn your [osu!lazer](https://lazer.ppy.sh) beatmap library into a terminal
> music player or a local music server for clients such as Kopuz.

## Requirements

- Node.js `20+`
- An osu!lazer install with beatmaps available locally
- `mpv` available on your `PATH` for the terminal player (not required for API
  or playlist export modes)

If you're developing locally, Realm's native bindings are still the one awkward part of this stack. Use the repo's `setup` script so Bun install and the Realm repair step happen in the right order.

## Installation


```bash
npm install -g osu-play
```

Or run it without a global install:

```bash
npx osu-play
```

## Usage

### CLI

```bash
# Launch the TUI player
osu-play

# Export a playlist file
osu-play --exportPlaylist playlist.txt

# Loop the playlist
osu-play --loop

# Start in shuffle mode
osu-play --shuffle

# Serve your library to Kopuz and other compatible clients
osu-play --api
```

### TUI Controls

- `Up/Down` or `j/k`: Move through the playlist
- `Left/Right` or `h/l`: Seek backward or forward by 5 seconds
- `Enter`: Play the selected track
- `Space`: Pause or resume playback
- `o`: Reveal the selected track in the native file manager
- `d`: Mark the selected beatmap set for deletion after confirmation
- `u`: Undo the most recent deletion while osu!lazer has not cleaned it up
- `n` / `p`: Next or previous track
- `PageUp` / `PageDown`: Jump faster through the playlist
- `x`: Toggle shuffle mode
- `r`: Toggle looping
- `s`: Stop playback
- `q`: Quit
- `/`: Enter search mode
- Type in search mode: Filter tracks by title
- `Up`/`Down` or `Ctrl+P`/`Ctrl+N` in search mode: Navigate matching tracks
- `Ctrl+W` in search mode: Delete the previous word
- `Backspace`: Edit the search query
- `Enter` in search mode: Play the selected match, leave search entry, and keep the filter
- `Esc`: Leave search mode, or clear the current query outside search mode

### Provider API for Kopuz

osu!play 1.4 adds a localhost music-provider mode that makes your existing
beatmap library available inside Kopuz—with album grouping, beatmap
backgrounds as artwork, original-quality streaming, and no separate library
import.

Start the provider:

```bash
osu-play --api
```

The server listens only on `http://127.0.0.1:4533`. In Kopuz:

1. Add a media server and choose **Custom (manual API)**.
2. Enter `http://127.0.0.1:4533` as the server URL.
3. Enter any non-empty username and password.

The provider exposes each osu! beatmap set as an album, streams the original
audio files, and uses beatmap backgrounds as cover art. It is intentionally
read-only: favorites and playlists are shown as empty and remote mutations are
not supported. Changes to the osu!lazer library are picked up the next time
Kopuz starts a library sync.

Use a different local port if needed:

```bash
osu-play --api --apiPort 5533
```

The API binds only to localhost and is not intended for LAN or internet
exposure.

### Library API

```ts
import { getLazerDB, getRealmDBPath } from "osu-play";

const realmPath = getRealmDBPath({ osuDataDir: "/path/to/osu" });
const db = await getLazerDB(realmPath);
```

## Options

- `--api`: Run the localhost Subsonic-compatible provider instead of the TUI
- `--apiPort`: Provider port (default: `4533`)
- `--reload, -r`: Deprecated and ignored
- `--exportPlaylist`: Export the discovered track paths to a file instead of launching the TUI
- `--osuDataDir, -d`: Override the osu!lazer data directory
- `--configDir, -c`: Deprecated and ignored
- `--loop, -l`: Restart from the beginning when playback reaches the end
- `--shuffle, -s`: Play the playlist in shuffled order
- `--help, -h`: Show help

## Development

Bun `1.3+` is required only for development and contributing; it is not needed to run the published CLI via `npm install -g` or `npx osu-play`.

```bash
bun run setup
bun run dev
bun run check
```

Useful day-to-day commands:

```bash
bun run dev
bun run dev -- --loop
bun run dev -- --exportPlaylist playlist.txt
bun run test
bun run package
```

If you hit a Realm native-binding error like `realm.node` missing or Node failing to load Realm:

```bash
bun install
bun run repair:realm
```

If `osu-play` fails with an `mpv` startup or IPC error, make sure `mpv` is installed and available on your shell `PATH`.

`bun run package` builds the distributable files and creates a local npm tarball with `bun pm pack`.

osu-play now reads osu!lazer's live `client.realm` directly in read-only mode instead of copying it into a separate app directory.

Standalone Bun executables are intentionally not part of the release flow right now. The current Realm dependency uses native bindings, and Bun's standalone executable support does not yet cover that path cleanly enough for this app.

## License

MIT
