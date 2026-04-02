import type { PlaylistTrack } from "../playlist/mod.js";
import type {
  PlayerBackend,
  PlayerBackendEvent,
  PlaylistPlayerListener,
  PlaylistPlayerSnapshot,
} from "./types.js";

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length - 1));
}

function wrapIndex(index: number, length: number) {
  if (length <= 0) {
    return 0;
  }

  return ((index % length) + length) % length;
}

function normalizeSearchText(text: string) {
  return text.trim().toLowerCase();
}

export function findTrackIndexByQuery(
  playlist: PlaylistTrack[],
  query: string,
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return -1;
  }

  return playlist.findIndex((track) =>
    normalizeSearchText(track.title).includes(normalizedQuery),
  );
}

type PlaylistPlayerSessionOptions = {
  loop?: boolean;
};

export class PlaylistPlayerSession {
  private readonly listeners = new Set<PlaylistPlayerListener>();

  private currentIndex: number | null = null;

  private errorMessage: string | null = null;

  private loop: boolean;

  private readonly playlist: PlaylistTrack[];

  private searchQuery = "";

  private selectedIndex = 0;

  private operationQueue: Promise<void> = Promise.resolve();

  private readonly unsubscribeBackend: () => void;

  constructor(
    playlist: PlaylistTrack[],
    private readonly backend: PlayerBackend,
    options: PlaylistPlayerSessionOptions = {},
  ) {
    this.playlist = playlist;
    this.loop = options.loop ?? false;
    this.unsubscribeBackend = backend.subscribe((event) => {
      void this.handleBackendEvent(event);
    });
  }

  getSnapshot(): PlaylistPlayerSnapshot {
    const backendSnapshot = this.backend.getSnapshot();
    const currentTrack =
      this.currentIndex !== null ? this.playlist[this.currentIndex] ?? null : null;

    return {
      backendName: backendSnapshot.backendName,
      currentIndex: this.currentIndex,
      currentTrack,
      durationSeconds: backendSnapshot.durationSeconds,
      errorMessage: this.errorMessage ?? backendSnapshot.errorMessage,
      loop: this.loop,
      playlist: this.playlist,
      searchQuery: this.searchQuery,
      selectedIndex: this.selectedIndex,
      status: backendSnapshot.status,
      timePositionSeconds: backendSnapshot.timePositionSeconds,
    };
  }

  subscribe(listener: PlaylistPlayerListener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.listeners.delete(listener);
    };
  }

  async start() {
    await this.backend.start();
    this.emit();
  }

  async dispose() {
    this.unsubscribeBackend();
    await this.backend.dispose();
  }

  moveSelection(delta: number) {
    if (this.playlist.length === 0) {
      return;
    }

    this.selectedIndex = wrapIndex(
      this.selectedIndex + delta,
      this.playlist.length,
    );
    this.emit();
  }

  moveSelectionPage(delta: number, pageSize: number) {
    this.moveSelection(delta * Math.max(1, pageSize));
  }

  selectHome() {
    if (this.playlist.length === 0) {
      return;
    }

    this.selectedIndex = 0;
    this.emit();
  }

  selectEnd() {
    if (this.playlist.length === 0) {
      return;
    }

    this.selectedIndex = this.playlist.length - 1;
    this.emit();
  }

  setSelectionIndex(index: number) {
    if (this.playlist.length === 0) {
      return;
    }

    this.selectedIndex = clampIndex(index, this.playlist.length);
    this.emit();
  }

  toggleLoop() {
    this.loop = !this.loop;
    this.emit();
  }

  appendSearchQuery(text: string) {
    if (!text) {
      return;
    }

    this.searchQuery += text;
    this.syncSelectionToSearch();
  }

  deleteSearchCharacter() {
    if (!this.searchQuery) {
      return;
    }

    this.searchQuery = this.searchQuery.slice(0, -1);
    this.syncSelectionToSearch();
  }

  clearSearch() {
    if (!this.searchQuery) {
      return;
    }

    this.searchQuery = "";
    this.emit();
  }

  async playSelected() {
    const selectedIndex = this.selectedIndex;
    await this.enqueueOperation(async () => {
      await this.playIndex(selectedIndex);
    });
  }

  async playNext() {
    await this.enqueueOperation(async () => {
      const nextIndex = this.getAdjacentIndex(1);
      if (nextIndex === null) {
        return;
      }

      await this.playIndex(nextIndex);
    });
  }

  async playPrevious() {
    await this.enqueueOperation(async () => {
      const previousIndex = this.getAdjacentIndex(-1);
      if (previousIndex === null) {
        return;
      }

      await this.playIndex(previousIndex);
    });
  }

  async togglePause() {
    const selectedIndex = this.selectedIndex;
    await this.enqueueOperation(async () => {
      if (this.playlist.length === 0) {
        return;
      }

      const { status } = this.backend.getSnapshot();
      if (status === "stopped") {
        const restartIndex = this.currentIndex ?? selectedIndex;
        await this.playIndex(restartIndex);
        return;
      }

      try {
        this.clearError();
        await this.backend.togglePause();
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  async seekBy(seconds: number) {
    await this.enqueueOperation(async () => {
      if (seconds === 0) {
        return;
      }

      const { status } = this.backend.getSnapshot();
      if (status === "stopped") {
        return;
      }

      try {
        this.clearError();
        await this.backend.seekBy(seconds);
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  async stop() {
    await this.enqueueOperation(async () => {
      try {
        this.clearError();
        await this.backend.stop();
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  reportError(error: unknown) {
    this.errorMessage =
      error instanceof Error ? error.message : String(error);
    this.emit();
  }

  private clearError() {
    if (this.errorMessage === null) {
      return;
    }

    this.errorMessage = null;
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async playIndex(index: number) {
    const track = this.playlist[index];
    if (!track) {
      return;
    }

    const previousIndex = this.currentIndex;
    this.currentIndex = index;

    try {
      this.clearError();
      await this.backend.play(track.path);
    } catch (error) {
      this.currentIndex = previousIndex;
      this.reportError(error);
      return;
    }

    this.emit();
  }

  private getAdjacentIndex(delta: number) {
    if (this.playlist.length === 0) {
      return null;
    }

    const baseIndex = this.currentIndex ?? this.selectedIndex;
    const nextIndex = baseIndex + delta;

    if (nextIndex < 0) {
      return this.loop ? this.playlist.length - 1 : null;
    }

    if (nextIndex >= this.playlist.length) {
      return this.loop ? 0 : null;
    }

    return nextIndex;
  }

  private handleBackendEvent(event: PlayerBackendEvent) {
    switch (event.type) {
      case "state":
        this.emit();
        return;
      case "error":
        this.reportError(event.error);
        return;
      case "ended":
        void this.enqueueOperation(async () => {
          if (event.reason === "eof") {
            const nextIndex = this.getAdjacentIndex(1);
            if (nextIndex !== null) {
              await this.playIndex(nextIndex);
              return;
            }
          }

          this.emit();
        });
    }
  }

  private enqueueOperation(operation: () => Promise<void>) {
    const queuedOperation = this.operationQueue.then(operation, operation);
    this.operationQueue = queuedOperation.catch(() => {});
    return queuedOperation;
  }

  private syncSelectionToSearch() {
    const matchedIndex = findTrackIndexByQuery(this.playlist, this.searchQuery);
    if (matchedIndex !== -1) {
      this.selectedIndex = matchedIndex;
    }

    this.emit();
  }
}
