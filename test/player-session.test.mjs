import { describe, expect, test } from "bun:test";

import {
  findTrackIndexByQuery,
  PlaylistPlayerSession,
} from "../src/core/player/mod.ts";
import {
  getVisibleTrackRange,
  PlaylistPlayerScreen,
} from "../src/core/tui/player-screen.ts";

function createTrack(id, title) {
  return {
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
    screen.handleInput("a");
    expect(session.getSnapshot().searchQuery).toBe("ga");

    screen.handleInput("\x1b");
    screen.handleInput("m");
    expect(session.getSnapshot().searchQuery).toBe("ga");
  });
});
