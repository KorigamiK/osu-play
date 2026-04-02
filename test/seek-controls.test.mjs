import { describe, expect, test } from "bun:test";

import {
  MpvPlayerBackend,
  PlaylistPlayerSession,
} from "../src/core/player/mod.ts";

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

describe("seek controls", () => {
  test("can seek immediately after starting playback with the mpv backend", async () => {
    const backend = new MpvPlayerBackend();
    const commands = [];

    backend.start = async () => {};
    backend.sendCommand = async (command) => {
      commands.push(command);
      return undefined;
    };

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

    expect(commands).toEqual([
      ["loadfile", "/osu/1.mp3", "replace"],
      ["set_property", "pause", false],
      ["seek", 5, "relative"],
    ]);
    expect(session.getSnapshot().status).toBe("playing");
  });

  test("keeps seek working after replacing the current track midway", async () => {
    const backend = new MpvPlayerBackend();
    const commands = [];

    backend.start = async () => {};
    backend.sendCommand = async (command) => {
      commands.push(command);
      return undefined;
    };

    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
      ],
      backend,
    );

    await session.start();
    await session.playSelected();

    session.moveSelection(1);
    await session.playSelected();

    backend.handleResponse({
      event: "end-file",
      reason: "stop",
    });

    await session.seekBy(5);

    expect(commands).toEqual([
      ["loadfile", "/osu/1.mp3", "replace"],
      ["set_property", "pause", false],
      ["loadfile", "/osu/2.mp3", "replace"],
      ["set_property", "pause", false],
      ["seek", 5, "relative"],
    ]);
    expect(session.getSnapshot().currentTrack?.title).toBe("Beta");
    expect(session.getSnapshot().status).toBe("playing");
  });

  test("queues seek behind an in-flight play request", async () => {
    const backend = new FakeBackend();
    const originalPlay = backend.play;
    backend.play = async (filePath) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await originalPlay(filePath);
    };

    const session = new PlaylistPlayerSession(
      [
        createTrack("1", "Alpha"),
        createTrack("2", "Beta"),
      ],
      backend,
    );

    await session.start();
    const playPromise = session.playSelected();
    const seekPromise = session.seekBy(5);

    await Promise.all([playPromise, seekPromise]);

    expect(session.getSnapshot().status).toBe("playing");
    expect(session.getSnapshot().timePositionSeconds).toBe(5);
  });
});
