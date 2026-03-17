import type { PlaylistTrack } from "../playlist/mod.js";

export type PlayerBackendStatus = "stopped" | "playing" | "paused";

export type PlayerBackendSnapshot = {
  backendName: string;
  currentPath: string | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  status: PlayerBackendStatus;
  timePositionSeconds: number | null;
};

export type PlayerBackendEvent =
  | {
      snapshot: PlayerBackendSnapshot;
      type: "state";
    }
  | {
      reason: string;
      type: "ended";
    }
  | {
      error: Error;
      type: "error";
    };

export type PlayerBackendListener = (event: PlayerBackendEvent) => void;

export interface PlayerBackend {
  readonly name: string;
  dispose(): Promise<void>;
  getSnapshot(): PlayerBackendSnapshot;
  play(filePath: string): Promise<void>;
  seekBy(seconds: number): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: PlayerBackendListener): () => void;
  togglePause(): Promise<void>;
}

export type PlaylistPlayerSnapshot = {
  backendName: string;
  currentIndex: number | null;
  currentTrack: PlaylistTrack | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  loop: boolean;
  playlist: PlaylistTrack[];
  searchQuery: string;
  selectedIndex: number;
  status: PlayerBackendStatus;
  timePositionSeconds: number | null;
};

export type PlaylistPlayerListener = (snapshot: PlaylistPlayerSnapshot) => void;
