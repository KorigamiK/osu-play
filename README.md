# osu-play

Play music from your osu!lazer beatmaps from the terminal.

## Requirements

- Node.js `20+`
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
# Play music interactively
osu-play

# Export a playlist file
osu-play --exportPlaylist playlist.txt

# Loop the playlist
osu-play --loop
```

### API

```ts
import { getLazerDB, getRealmDBPath } from "osu-play";

const realmPath = getRealmDBPath({ osuDataDir: "/path/to/osu" });
const db = await getLazerDB(realmPath);
```

## Options

- `--reload, -r`: Deprecated and ignored
- `--exportPlaylist`: Export the discovered track paths to a file
- `--osuDataDir, -d`: Override the osu!lazer data directory
- `--configDir, -c`: Deprecated and ignored
- `--loop, -l`: Restart from the beginning when the playlist ends
- `--help, -h`: Show help

## Development

Bun `1.3+` is required only for development and contributing; it is not needed to run the published CLI via `npm install -g` or `npx osu-play`.

```bash
bun run setup
bun run dev -- --help
bun run check
```

Useful day-to-day commands:

```bash
bun run dev -- --help
bun run test
bun run package
```

If you hit a Realm native-binding error like `realm.node` missing or Node failing to load Realm:

```bash
bun install
bun run repair:realm
```

`bun run package` builds the distributable files and creates a local npm tarball with `bun pm pack`.

osu-play now reads osu!lazer's live `client.realm` directly in read-only mode instead of copying it into a separate app directory.

Standalone Bun executables are intentionally not part of the release flow right now. The current Realm dependency uses native bindings, and Bun's standalone executable support does not yet cover that path cleanly enough for this app.

## License

MIT
