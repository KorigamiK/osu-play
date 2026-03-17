# osu-play

Play music from your osu!lazer beatmaps from the terminal.

## Requirements

- Node.js `20+`
- `mpv` available on your `PATH`
- An osu!lazer install with beatmaps available locally

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
```

### TUI Controls

- `Up/Down` or `j/k`: Move through the playlist
- `Enter`: Play the selected track
- `Space`: Pause or resume playback
- `n` / `p`: Next or previous track
- `PageUp` / `PageDown`: Jump faster through the playlist
- `l`: Toggle looping
- `s`: Stop playback
- `q`: Quit
- `/`: Enter search mode
- Type in search mode: Jump the selection by track title
- `Backspace`: Edit the search query
- `Enter`: Leave search mode and keep the current query
- `Esc`: Leave search mode, or clear the current query outside search mode

### API

```ts
import { getLazerDB, getRealmDBPath } from "osu-play";

const realmPath = getRealmDBPath({ osuDataDir: "/path/to/osu" });
const db = await getLazerDB(realmPath);
```

## Options

- `--reload, -r`: Deprecated and ignored
- `--exportPlaylist`: Export the discovered track paths to a file instead of launching the TUI
- `--osuDataDir, -d`: Override the osu!lazer data directory
- `--configDir, -c`: Deprecated and ignored
- `--loop, -l`: Restart from the beginning when playback reaches the end
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
