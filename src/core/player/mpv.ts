import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  PlayerBackend,
  PlayerBackendEvent,
  PlayerBackendListener,
  PlayerBackendSnapshot,
} from "./types.js";

type PendingCommand = {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
};

type MpvResponse = {
  data?: unknown;
  error?: string;
  event?: string;
  name?: string;
  reason?: string;
  request_id?: number;
};

function createSocketPath() {
  const id = `osu-play-mpv-${process.pid}-${Date.now()}`;
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${id}`;
  }

  return path.join(os.tmpdir(), `${id}.sock`);
}

function isControlText(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });
}

export class MpvPlayerBackend implements PlayerBackend {
  readonly name = "mpv";

  private connectPromise: Promise<void> | null = null;

  private disposePromise: Promise<void> | null = null;

  private disposing = false;

  private readonly listeners = new Set<PlayerBackendListener>();

  private readonly pendingCommands = new Map<number, PendingCommand>();

  private process: ChildProcess | null = null;

  private requestId = 0;

  private responseBuffer = "";

  private snapshot: PlayerBackendSnapshot = {
    backendName: "mpv",
    currentPath: null,
    durationSeconds: null,
    errorMessage: null,
    status: "stopped",
    timePositionSeconds: null,
  };

  private socket: net.Socket | null = null;

  private readonly socketPath = createSocketPath();

  private stderrBuffer = "";

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: PlayerBackendListener) {
    this.listeners.add(listener);
    listener({
      snapshot: this.snapshot,
      type: "state",
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  async start() {
    if (this.socket && !this.socket.destroyed) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.startInternal();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async play(filePath: string) {
    await this.start();

    this.snapshot = {
      ...this.snapshot,
      currentPath: filePath,
      durationSeconds: null,
      errorMessage: null,
      status: "playing",
      timePositionSeconds: 0,
    };
    this.emit({
      snapshot: this.snapshot,
      type: "state",
    });

    await this.sendCommand(["loadfile", filePath, "replace"]);
    await this.sendCommand(["set_property", "pause", false]);
  }

  async togglePause() {
    await this.start();
    await this.sendCommand(["cycle", "pause"]);
  }

  async stop() {
    if (!this.socket || this.socket.destroyed) {
      return;
    }

    await this.sendCommand(["stop"]);
  }

  async dispose() {
    if (this.disposePromise) {
      return this.disposePromise;
    }

    this.disposePromise = this.disposeInternal();

    try {
      await this.disposePromise;
    } finally {
      this.disposePromise = null;
    }
  }

  private emit(event: PlayerBackendEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async startInternal() {
    this.cleanupSocketPath();
    this.disposing = false;
    this.stderrBuffer = "";

    const processHandle = spawn(
      "mpv",
      [
        "--no-config",
        "--no-terminal",
        "--idle=yes",
        "--force-window=no",
        "--audio-display=no",
        "--really-quiet",
        `--input-ipc-server=${this.socketPath}`,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    this.process = processHandle;

    processHandle.stderr.setEncoding("utf8");
    processHandle.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4000);
    });

    processHandle.once("error", (error) => {
      this.handleError(error);
    });

    processHandle.once("exit", (code, signal) => {
      if (this.disposing) {
        return;
      }

      const detail = this.stderrBuffer.trim();
      const suffix = detail ? `\n${detail}` : "";
      this.handleError(
        new Error(
          `mpv exited unexpectedly with ${signal ? `signal ${signal}` : `code ${code}`}.${suffix}`,
        ),
      );
    });

    await this.connectSocket();
    await Promise.all([
      this.sendCommand(["observe_property", 1, "pause"]),
      this.sendCommand(["observe_property", 2, "time-pos"]),
      this.sendCommand(["observe_property", 3, "duration"]),
      this.sendCommand(["observe_property", 4, "idle-active"]),
    ]);
  }

  private async connectSocket() {
    const start = Date.now();
    const timeoutMs = 5000;

    while (Date.now() - start < timeoutMs) {
      if (!this.process || this.process.exitCode !== null) {
        throw new Error(this.formatStartupError("mpv exited before opening its IPC socket."));
      }

      try {
        await this.attachSocket();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !message.includes("ENOENT")
          && !message.includes("ECONNREFUSED")
          && !message.includes("EPERM")
          && !message.includes("EACCES")
        ) {
          throw error;
        }
      }

      await delay(50);
    }

    throw new Error(this.formatStartupError("Timed out waiting for mpv IPC to become ready."));
  }

  private async attachSocket() {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      const onError = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      socket.once("error", onError);
      socket.once("connect", () => {
        socket.removeListener("error", onError);
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
          this.handleSocketData(chunk);
        });
        socket.on("error", (error) => {
          if (!this.disposing) {
            this.handleError(error);
          }
        });
        socket.on("close", () => {
          if (!this.disposing) {
            this.handleError(new Error("mpv IPC socket closed unexpectedly."));
          }
        });
        this.socket = socket;
        resolve();
      });
    });
  }

  private async sendCommand(command: unknown[]) {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error("mpv IPC socket is not connected.");
    }

    const requestId = ++this.requestId;

    return new Promise<unknown>((resolve, reject) => {
      this.pendingCommands.set(requestId, { reject, resolve });

      socket.write(
        `${JSON.stringify({ command, request_id: requestId })}\n`,
        (error) => {
          if (!error) {
            return;
          }

          this.pendingCommands.delete(requestId);
          reject(error);
        },
      );
    });
  }

  private handleSocketData(chunk: string) {
    this.responseBuffer += chunk;

    while (true) {
      const newlineIndex = this.responseBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.responseBuffer.slice(0, newlineIndex).trim();
      this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      try {
        const response = JSON.parse(line) as MpvResponse;
        this.handleResponse(response);
      } catch (error) {
        this.handleError(
          new Error(
            `Failed to parse mpv IPC message: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    }
  }

  private handleResponse(response: MpvResponse) {
    if (typeof response.request_id === "number") {
      const pending = this.pendingCommands.get(response.request_id);
      if (pending) {
        this.pendingCommands.delete(response.request_id);
        if (response.error && response.error !== "success") {
          pending.reject(new Error(`mpv command failed: ${response.error}`));
        } else {
          pending.resolve(response.data);
        }
      }
      return;
    }

    if (response.event === "property-change") {
      this.applyPropertyChange(response.name, response.data);
      return;
    }

    if (response.event === "end-file") {
      this.snapshot = {
        ...this.snapshot,
        status: "stopped",
        timePositionSeconds: this.snapshot.durationSeconds,
      };
      this.emit({
        snapshot: this.snapshot,
        type: "state",
      });
      this.emit({
        reason: response.reason ?? "unknown",
        type: "ended",
      });
    }
  }

  private applyPropertyChange(name: string | undefined, data: unknown) {
    switch (name) {
      case "pause":
        this.snapshot = {
          ...this.snapshot,
          status: data === true ? "paused" : this.snapshot.status === "stopped" ? "playing" : "playing",
        };
        break;
      case "time-pos":
        this.snapshot = {
          ...this.snapshot,
          timePositionSeconds: typeof data === "number" ? data : null,
        };
        break;
      case "duration":
        this.snapshot = {
          ...this.snapshot,
          durationSeconds: typeof data === "number" ? data : null,
        };
        break;
      case "idle-active":
        this.snapshot = {
          ...this.snapshot,
          status: data === true ? "stopped" : this.snapshot.status === "paused" ? "paused" : "playing",
          timePositionSeconds:
            data === true ? this.snapshot.durationSeconds : this.snapshot.timePositionSeconds,
        };
        break;
      default:
        return;
    }

    this.emit({
      snapshot: this.snapshot,
      type: "state",
    });
  }

  private handleError(error: unknown) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));

    this.snapshot = {
      ...this.snapshot,
      errorMessage: normalizedError.message,
      status: "stopped",
    };

    this.emit({
      error: normalizedError,
      type: "error",
    });

    for (const [requestId, pending] of this.pendingCommands) {
      this.pendingCommands.delete(requestId);
      pending.reject(normalizedError);
    }
  }

  private async disposeInternal() {
    this.disposing = true;

    if (this.socket && !this.socket.destroyed) {
      try {
        await this.sendCommand(["quit"]);
      } catch {
        // Ignore quit errors during shutdown.
      }
    }

    this.socket?.destroy();
    this.socket = null;

    const processHandle = this.process;
    this.process = null;
    if (processHandle && processHandle.exitCode === null) {
      processHandle.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => {
          processHandle.once("exit", () => resolve());
        }),
        delay(1000),
      ]);

      if (processHandle.exitCode === null) {
        processHandle.kill("SIGKILL");
      }
    }

    this.cleanupSocketPath();
  }

  private cleanupSocketPath() {
    if (process.platform === "win32") {
      return;
    }

    if (existsSync(this.socketPath)) {
      rmSync(this.socketPath, { force: true });
    }
  }

  private formatStartupError(message: string) {
    const stderr = this.stderrBuffer.trim();
    const cleanStderr = stderr && !isControlText(stderr) ? `\n${stderr}` : "";

    return [
      message,
      "osu-play now expects `mpv` to be installed and available on PATH for TUI playback.",
      cleanStderr,
    ]
      .filter(Boolean)
      .join("\n");
  }
}
