# osu!play v1.4.0 — your beatmap library, now in Kopuz

![osu!play beatmaps inside Kopuz](https://raw.githubusercontent.com/KorigamiK/osu-play/v1.4.0/.github/releases/v1.4.0/kopuz-api.png)

The headline feature in v1.4.0 is a new local music-provider mode. Your
osu!lazer beatmap collection can now appear directly inside
[Kopuz](https://github.com/Kopuz-org/kopuz), complete with albums, artists,
beatmap backgrounds, and original-quality playback.

## What’s new

- **Kopuz integration:** run `osu-play --api` and connect Kopuz using its
  **Custom (manual API)** provider.
- **No duplicate library:** osu!play reads osu!lazer’s live Realm database and
  serves its content-addressed audio files directly.
- **Beatmap sets become albums:** titles and artists stay structured, while
  beatmap backgrounds become album and track artwork.
- **Original-quality streaming:** clients receive the stored audio without
  transcoding, with HEAD and byte-range support for reliable playback and
  seeking.
- **Automatic library refresh:** newly imported or removed beatmaps appear the
  next time Kopuz starts a library sync.
- **Local by design:** the provider binds only to `127.0.0.1`, stores no
  credentials, and never writes to the osu!lazer database.
- **Shuffle playback:** the terminal player now supports startup shuffle with
  `--shuffle` and an interactive `x` toggle.

## Get started

Install or upgrade:

```bash
npm install -g osu-play@1.4.0
```

Start the provider:

```bash
osu-play --api
```

Then add a server in Kopuz:

1. Choose **Custom (manual API)**.
2. Use `http://127.0.0.1:4533` as the server URL.
3. Enter any non-empty username and password.

Use `osu-play --api --apiPort 5533` if the default port is already occupied.

## Compatibility and safety

This first provider release targets the Subsonic-compatible API calls used by
Kopuz. Library browsing, artwork, streaming, lyrics fallback, and scrobble
acknowledgement are supported. Remote playlists and favorites are intentionally
read-only in v1.4.0, and the provider is not intended for LAN or internet
exposure.

The existing terminal player, playlist export, and JavaScript library API
continue to work as before. API and export modes do not require mpv.
