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

export function findTrackIndicesByQuery(
  playlist: PlaylistTrack[],
  query: string,
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return playlist.map((_, index) => index);
  }

  return playlist.flatMap((track, index) =>
    normalizeSearchText(track.title).includes(normalizedQuery) ? [index] : [],
  );
}

type PlaylistPlayerSessionOptions = {
  deleteTrack?: (track: PlaylistTrack) => Promise<void>;
  loop?: boolean;
  reloadPlaylist?: () => Promise<PlaylistTrack[]>;
  revealTrack?: (track: PlaylistTrack) => Promise<void>;
};

export class PlaylistPlayerSession {
  private readonly listeners = new Set<PlaylistPlayerListener>();

  private currentIndex: number | null = null;

  private errorMessage: string | null = null;

  private loop: boolean;

  private deleteTrack?: (track: PlaylistTrack) => Promise<void>;

  private playlist: PlaylistTrack[];

  private readonly reloadPlaylist?: () => Promise<PlaylistTrack[]>;

  private readonly revealTrack?: (track: PlaylistTrack) => Promise<void>;

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
    this.deleteTrack = options.deleteTrack;
    this.loop = options.loop ?? false;
    this.reloadPlaylist = options.reloadPlaylist;
    this.revealTrack = options.revealTrack;
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

    if (this.searchQuery) {
      this.moveSearchSelection(delta);
      return;
    }

    this.selectedIndex = wrapIndex(
      this.selectedIndex + delta,
      this.playlist.length,
    );
    this.emit();
  }

  moveSelectionPage(delta: number, pageSize: number) {
    if (this.searchQuery) {
      this.moveSearchSelection(delta * Math.max(1, pageSize));
      return;
    }

    this.moveSelection(delta * Math.max(1, pageSize));
  }

  moveSearchSelection(delta: number) {
    const matches = findTrackIndicesByQuery(this.playlist, this.searchQuery);
    if (matches.length === 0) {
      return;
    }

    const currentMatchIndex = matches.indexOf(this.selectedIndex);
    const nextMatchIndex = wrapIndex(currentMatchIndex + delta, matches.length);
    this.selectedIndex = matches[nextMatchIndex] ?? this.selectedIndex;
    this.emit();
  }

  selectHome() {
    if (this.playlist.length === 0) {
      return;
    }

    const matches = findTrackIndicesByQuery(this.playlist, this.searchQuery);
    this.selectedIndex = matches[0] ?? 0;
    this.emit();
  }

  selectEnd() {
    if (this.playlist.length === 0) {
      return;
    }

    const matches = findTrackIndicesByQuery(this.playlist, this.searchQuery);
    this.selectedIndex = matches.at(-1) ?? this.playlist.length - 1;
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
      const nextIndex = this.getAdjacentIndex(1, true);
      if (nextIndex === null) {
        return;
      }

      await this.playIndex(nextIndex);
    });
  }

  async playPrevious() {
    await this.enqueueOperation(async () => {
      const previousIndex = this.getAdjacentIndex(-1, true);
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

  async revealSelectedTrack() {
    const track = this.playlist[this.selectedIndex];
    if (!track) {
      return;
    }

    if (!this.revealTrack) {
      this.reportError(new Error("Opening the containing folder is unavailable."));
      return;
    }

    try {
      this.clearError();
      await this.revealTrack(track);
    } catch (error) {
      this.reportError(error);
    }
  }

  async deleteSelectedTrack() {
    const selectedIndex = this.selectedIndex;
    await this.enqueueOperation(async () => {
      const track = this.playlist[selectedIndex];
      if (!track) {
        return;
      }

      if (!this.deleteTrack || !this.reloadPlaylist) {
        this.reportError(new Error("Beatmap deletion is unavailable in this session."));
        return;
      }

      const currentTrack =
        this.currentIndex !== null ? this.playlist[this.currentIndex] ?? null : null;
      const deletingCurrentTrack =
        currentTrack !== null && currentTrack.beatmapSetKey === track.beatmapSetKey;

      try {
        this.clearError();

        if (deletingCurrentTrack) {
          await this.backend.stop();
          this.currentIndex = null;
        }

        await this.deleteTrack(track);
        this.playlist = await this.reloadPlaylist();
        this.selectedIndex = clampIndex(selectedIndex, this.playlist.length);

        if (this.searchQuery) {
          const matchedIndex = findTrackIndexByQuery(this.playlist, this.searchQuery);
          if (matchedIndex !== -1) {
            this.selectedIndex = matchedIndex;
          }
        }

        if (!deletingCurrentTrack && currentTrack) {
          const nextCurrentIndex = this.playlist.findIndex(
            (playlistTrack) => playlistTrack.hash === currentTrack.hash,
          );
          this.currentIndex = nextCurrentIndex === -1 ? null : nextCurrentIndex;
        }

        this.emit();
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

    // Keep the cursor on the track that is now playing so n/p (and
    // auto-advance) move the selection along with playback.
    this.selectedIndex = index;
    this.emit();
  }

  private getAdjacentIndex(delta: number, wrap = false) {
    if (this.playlist.length === 0) {
      return null;
    }

    const baseIndex = this.currentIndex ?? this.selectedIndex;
    const nextIndex = baseIndex + delta;
    const shouldWrap = wrap || this.loop;

    if (nextIndex < 0) {
      return shouldWrap ? this.playlist.length - 1 : null;
    }

    if (nextIndex >= this.playlist.length) {
      return shouldWrap ? 0 : null;
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
