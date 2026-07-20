import { describe, expect, test } from "bun:test";

import {
  findTrackIndexByQuery,
  findTrackIndicesByQuery,
  PlaylistPlayerSession,
} from "../src/core/player/mod.ts";
import {
  getVisibleTrackRange,
  PlaylistPlayerScreen,
} from "../src/core/tui/player-screen.ts";

function createTrack(id, title) {
  return {
    beatmapSetHash: `set-hash-${id}`,
    beatmapSetId: `set-${id}`,
    beatmapSetKey: `set-${id}`,
    hash: `hash-${id}`,
    path: `/osu/${id}.mp3`,
    title,
  };
}

class FakeBackend {
  name = "fake";

  snapshot = {
    backendName: "fake",
    currentPath: null,
    durationSeconds: null,
    errorMessage: null,
    status: "stopped",
    timePositionSeconds: null,
  };

  listeners = new Set();

  dispose = async () => {};

  getSnapshot = () => this.snapshot;

  play = async (filePath) => {
    this.snapshot = {
      ...this.snapshot,
      currentPath: filePath,
      errorMessage: null,
      status: "playing",
      timePositionSeconds: 0,
    };
    this.emit({
      snapshot: this.snapshot,
      type: "state",
    });
  };

  start = async () => {};

  stop = async () => {
    this.snapshot = {
      ...this.snapshot,
      status: "stopped",
    };
    this.emit({
      snapshot: this.snapshot,
      type: "state",
    });
  };

  subscribe = (listener) => {
    this.listeners.add(listener);
    listener({
      snapshot: this.snapshot,
      type: "state",
    });

    return () => {
      this.listeners.delete(listener);
    };
  };

  togglePause = async () => {
    this.snapshot = {
      ...this.snapshot,
      status: this.snapshot.status === "paused" ? "playing" : "paused",
    };
    this.emit({
      snapshot: this.snapshot,
      type: "state",
    });
  };

  seekBy = async (seconds) => {
    this.snapshot = {
      ...this.snapshot,
      timePositionSeconds: Math.max(
        0,
        (this.snapshot.timePositionSeconds ?? 0) + seconds,
      ),
    };
    this.emit({
      snapshot: this.snapshot,
      type: "state",
    });
  };

  emit = (event) => {
    for (const listener of this.listeners) {
      listener(event);
    }
  };
}

describe("player session", () => {
  test("findTrackIndexByQuery matches case-insensitive substrings", () => {
    const playlist = [
      createTrack("1", "Snow Drive - Omega"),
      createTrack("2", "Night of Knights - BeatMARIO"),
    ];

    expect(findTrackIndexByQuery(playlist, "knights")).toBe(1);
    expect(findTrackIndexByQuery(playlist, "SNOW")).toBe(0);
    expect(findTrackIndexByQuery(playlist, "missing")).toBe(-1);
  });

  test("findTrackIndicesByQuery returns every matching track", () => {
    const playlist = [
      createTrack("1", "Blue Sky"),
      createTrack("2", "Red Moon"),
      createTrack("3", "Blue Moon"),
    ];

    expect(findTrackIndicesByQuery(playlist, "moon")).toEqual([1, 2]);
    expect(findTrackIndicesByQuery(playlist, "blue moon")).toEqual([2]);
  });

  test("auto-advances to the next track on eof", async () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "First"),
        createTrack("2", "Second"),
      ],
      backend,
    );

    await session.start();
    await session.playSelected();

    backend.emit({
      reason: "eof",
      type: "ended",
    });
    await Promise.resolve();

    const snapshot = session.getSnapshot();
    expect(snapshot.currentIndex).toBe(1);
    expect(snapshot.currentTrack?.title).toBe("Second");
    expect(snapshot.status).toBe("playing");
  });

  test("loops back to the first track when looping is enabled", async () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "First"),
        createTrack("2", "Second"),
      ],
      backend,
      { loop: true },
    );

    await session.start();
    session.selectEnd();
    await session.playSelected();

    backend.emit({
      reason: "eof",
      type: "ended",
    });
    await Promise.resolve();

    const snapshot = session.getSnapshot();
    expect(snapshot.currentIndex).toBe(0);
    expect(snapshot.currentTrack?.title).toBe("First");
    expect(snapshot.status).toBe("playing");
  });

  test("n/p wrap around the playlist even when looping is disabled", async () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "First"),
        createTrack("2", "Second"),
      ],
      backend,
    );

    await session.start();
    session.selectEnd();
    await session.playSelected();
    expect(session.getSnapshot().currentIndex).toBe(1);

    await session.playNext();
    expect(session.getSnapshot().currentIndex).toBe(0);

    await session.playPrevious();
    expect(session.getSnapshot().currentIndex).toBe(1);
  });

  test("eof does not wrap when looping is disabled", async () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "First"),
        createTrack("2", "Second"),
      ],
      backend,
    );

    await session.start();
    session.selectEnd();
    await session.playSelected();

    backend.emit({
      reason: "eof",
      type: "ended",
    });
    await Promise.resolve();

    const snapshot = session.getSnapshot();
    expect(snapshot.currentIndex).toBe(1);
  });

  test("plays every track in a stable shuffled order", async () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "First"),
        createTrack("2", "Second"),
        createTrack("3", "Third"),
        createTrack("4", "Fourth"),
      ],
      backend,
      { random: () => 0, shuffle: true },
    );

    await session.playSelected();
    expect(session.getSnapshot().currentTrack?.title).toBe("First");

    backend.emit({
      reason: "eof",
      type: "ended",
    });
    await Promise.resolve();
    expect(session.getSnapshot().currentTrack?.title).toBe("Third");

    await session.playNext();
    expect(session.getSnapshot().currentTrack?.title).toBe("Fourth");

    await session.playNext();
    expect(session.getSnapshot().currentTrack?.title).toBe("Second");

    await session.playPrevious();
    expect(session.getSnapshot().currentTrack?.title).toBe("Fourth");
  });

  test("starts a new shuffle cycle from an explicitly selected track", async () => {
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "First"),
        createTrack("2", "Second"),
        createTrack("3", "Third"),
        createTrack("4", "Fourth"),
      ],
      new FakeBackend(),
      { random: () => 0 },
    );

    session.setSelectionIndex(2);
    session.toggleShuffle();
    await session.playSelected();
    await session.playNext();

    expect(session.getSnapshot().shuffle).toBe(true);
    expect(session.getSnapshot().currentTrack?.title).toBe("Second");
  });

  test("updates selection from the jump query", () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
        createTrack("3", "Gamma"),
      ],
      backend,
    );

    session.appendSearchQuery("ga");

    expect(session.getSnapshot().selectedIndex).toBe(2);

    session.deleteSearchCharacter();
    expect(session.getSnapshot().searchQuery).toBe("g");

    session.clearSearch();
    expect(session.getSnapshot().searchQuery).toBe("");
  });

  test("seeks through the current track while playing", async () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
      ],
      backend,
    );

    await session.start();
    await session.playSelected();
    await session.seekBy(5);
    expect(session.getSnapshot().timePositionSeconds).toBe(5);

    await session.seekBy(-2);
    expect(session.getSnapshot().timePositionSeconds).toBe(3);
  });

  test("wraps selection from the top to the end and back again", () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
        createTrack("3", "Gamma"),
      ],
      backend,
    );

    session.moveSelection(-1);
    expect(session.getSnapshot().selectedIndex).toBe(2);

    session.moveSelection(1);
    expect(session.getSnapshot().selectedIndex).toBe(0);
  });

  test("deletes the selected beatmap set after confirmation-safe session wiring", async () => {
    const backend = new FakeBackend();
    const deletedTracks = [];
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
        createTrack("3", "Gamma"),
      ],
      backend,
      {
        deleteTrack: async (track) => {
          deletedTracks.push(track.title);
        },
        reloadPlaylist: async () => [
          createTrack("2", "Beta"),
          createTrack("3", "Gamma"),
        ],
      },
    );

    await session.deleteSelectedTrack();

    expect(deletedTracks).toEqual(["Alpha"]);
    expect(session.getSnapshot().playlist.map((track) => track.title)).toEqual([
      "Beta",
      "Gamma",
    ]);
    expect(session.getSnapshot().selectedIndex).toBe(0);
  });
});

describe("player screen helpers", () => {
  test("centers the selected track in the visible range when possible", () => {
    expect(getVisibleTrackRange(7, 20, 5)).toEqual({
      end: 10,
      start: 5,
    });
  });

  test("clamps the visible range near the end of the playlist", () => {
    expect(getVisibleTrackRange(19, 20, 5)).toEqual({
      end: 20,
      start: 15,
    });
  });

  test("keeps player commands out of the query unless search mode is active", () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
        createTrack("3", "Gamma"),
      ],
      backend,
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("n");
    expect(session.getSnapshot().searchQuery).toBe("");

    screen.handleInput("/");
    screen.handleInput("g");
    screen.handleInput(" ");
    screen.handleInput("a");
    expect(session.getSnapshot().searchQuery).toBe("g a");

    screen.handleInput("\x1b");
    screen.handleInput("m");
    expect(session.getSnapshot().searchQuery).toBe("g a");
  });

  test("toggles shuffle with x outside search mode", () => {
    const session = new PlaylistPlayerSession(
      [createTrack("1", "Alpha"), createTrack("2", "Beta")],
      new FakeBackend(),
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("x");
    expect(session.getSnapshot().shuffle).toBe(true);
    screen.setSnapshot(session.getSnapshot());
    expect(screen.render(80).join("\n")).toContain("shuffle on");

    screen.handleInput("/");
    screen.handleInput("x");
    expect(session.getSnapshot().searchQuery).toBe("x");
    expect(session.getSnapshot().shuffle).toBe(true);
  });

  test("navigates between matching search results", () => {
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Blue Sky"),
        createTrack("2", "Red Moon"),
        createTrack("3", "Blue Moon"),
      ],
      new FakeBackend(),
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("/");
    for (const character of "moon") screen.handleInput(character);
    expect(session.getSnapshot().selectedIndex).toBe(1);

    screen.handleInput("\x1b[B");
    expect(session.getSnapshot().selectedIndex).toBe(2);

    screen.handleInput("\x1b[B");
    expect(session.getSnapshot().selectedIndex).toBe(1);
    screen.setSnapshot(session.getSnapshot());
    expect(screen.render(80).join("\n")).not.toContain("Blue Sky");
  });

  test("reveals the selected track with o outside search mode", async () => {
    const revealedTracks = [];
    const session = new PlaylistPlayerSession(
      [createTrack("1", "Blue Sky")],
      new FakeBackend(),
      {
        revealTrack: async (track) => revealedTracks.push(track.path),
      },
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("o");
    await Promise.resolve();
    expect(revealedTracks).toEqual(["/osu/1.mp3"]);

    screen.handleInput("/");
    screen.handleInput("o");
    expect(session.getSnapshot().searchQuery).toBe("o");
    expect(revealedTracks).toEqual(["/osu/1.mp3"]);
  });

  test("plays a search result and keeps movement within retained matches", async () => {
    const backend = new FakeBackend();
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Moon One"),
        createTrack("2", "Hidden Track"),
        createTrack("3", "Moon Two"),
      ],
      backend,
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("/");
    for (const character of "moon") screen.handleInput(character);
    screen.handleInput("\x1b[B");
    screen.handleInput("\r");
    await Promise.resolve();

    expect(session.getSnapshot().currentIndex).toBe(2);
    expect(session.getSnapshot().searchQuery).toBe("moon");

    screen.handleInput("k");
    expect(session.getSnapshot().selectedIndex).toBe(0);
    screen.handleInput("j");
    expect(session.getSnapshot().selectedIndex).toBe(2);
  });

  test("deletes the previous search word with ctrl-w", () => {
    const session = new PlaylistPlayerSession(
      [createTrack("1", "Blue Moon Remix")],
      new FakeBackend(),
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("/");
    for (const character of "blue moon remix") screen.handleInput(character);
    screen.handleInput("\x17");
    expect(session.getSnapshot().searchQuery).toBe("blue moon");

    screen.handleInput("\x17");
    expect(session.getSnapshot().searchQuery).toBe("blue");
    screen.handleInput("\x17");
    expect(session.getSnapshot().searchQuery).toBe("");
  });

  test("requires a second confirmation key before deleting a beatmap set", async () => {
    const backend = new FakeBackend();
    let deleteCalls = 0;
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
      ],
      backend,
      {
        deleteTrack: async () => {
          deleteCalls += 1;
        },
        reloadPlaylist: async () => [createTrack("2", "Beta")],
      },
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("d");
    expect(deleteCalls).toBe(0);

    screen.handleInput("d");
    await Promise.resolve();
    expect(deleteCalls).toBe(1);
  });

  test("cancels beatmap deletion when the confirmation key is not repeated", () => {
    const backend = new FakeBackend();
    let deleteCalls = 0;
    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
      ],
      backend,
      {
        deleteTrack: async () => {
          deleteCalls += 1;
        },
        reloadPlaylist: async () => [createTrack("2", "Beta")],
      },
    );
    const screen = new PlaylistPlayerScreen(session, () => 20);

    screen.handleInput("d");
    screen.handleInput("j");

    expect(deleteCalls).toBe(0);
    expect(session.getSnapshot().selectedIndex).toBe(0);
  });
});
