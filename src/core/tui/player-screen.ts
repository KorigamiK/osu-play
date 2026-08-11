import {
  type Component,
  decodeKittyPrintable,
  Key,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";

import type { PlaylistPlayerSession } from "../player/mod.js";
import { findTrackIndicesByQuery } from "../player/mod.js";
import type { PlaylistPlayerSnapshot } from "../player/types.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const INVERSE = "\x1b[7m";

const MIN_LIST_ROWS = 4;
const RESERVED_ROWS = 5;
const PAGE_SIZE = 10;
const PENDING_G_TIMEOUT_MS = 400;
const SEEK_SECONDS = 5;

const STATUS_GLYPH: Record<string, string> = {
  paused: "⏸",
  playing: "▶",
  stopped: "■",
};

function style(text: string, code: string) {
  return `${code}${text}${RESET}`;
}

function progressBar(
  position: number | null,
  duration: number | null,
  width: number,
) {
  const span = Math.max(4, width);
  const ratio =
    duration && duration > 0 && position !== null
      ? Math.max(0, Math.min(position / duration, 1))
      : 0;
  const filled = Math.round(ratio * span);

  return (
    style("━".repeat(filled), CYAN) + style("─".repeat(span - filled), DIM)
  );
}

function padIndex(index: number, total: number) {
  const width = String(Math.max(total, 1)).length;
  return String(index + 1).padStart(width, " ");
}

function formatSeconds(seconds: number | null) {
  if (seconds === null || Number.isNaN(seconds)) {
    return "--:--";
  }

  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function decodePrintableText(data: string) {
  const kittyPrintable = decodeKittyPrintable(data);
  if (kittyPrintable !== undefined) {
    return kittyPrintable;
  }

  const hasControlChars = [...data].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });

  return hasControlChars ? undefined : data;
}

export function getVisibleTrackRange(
  selectedIndex: number,
  totalTracks: number,
  maxVisible: number,
) {
  if (totalTracks <= 0 || maxVisible <= 0) {
    return { end: 0, start: 0 };
  }

  const clampedSelectedIndex = Math.max(
    0,
    Math.min(selectedIndex, totalTracks - 1),
  );
  const start = Math.max(
    0,
    Math.min(
      clampedSelectedIndex - Math.floor(maxVisible / 2),
      totalTracks - maxVisible,
    ),
  );

  return {
    end: Math.min(totalTracks, start + maxVisible),
    start,
  };
}

export class PlaylistPlayerScreen implements Component {
  private deleteConfirmationTrackKey: string | null = null;

  private pendingGoToTop = false;

  private pendingGoToTopTimer: ReturnType<typeof setTimeout> | null = null;

  private searchMode = false;

  private snapshot: PlaylistPlayerSnapshot;

  onQuit?: () => void;

  constructor(
    private readonly session: PlaylistPlayerSession,
    private readonly getViewportHeight: () => number,
  ) {
    this.snapshot = session.getSnapshot();
  }

  setSnapshot(snapshot: PlaylistPlayerSnapshot) {
    this.snapshot = snapshot;
  }

  invalidate() {
    // This screen renders from live snapshot state only.
  }

  handleInput(data: string) {
    if (this.deleteConfirmationTrackKey !== null) {
      this.handleDeleteConfirmationInput(data);
      return;
    }

    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }

    if (matchesKey(data, Key.slash)) {
      this.searchMode = true;
      return;
    }

    if (matchesKey(data, "g")) {
      if (this.pendingGoToTop) {
        this.clearPendingGoToTop();
        this.session.selectHome();
      } else {
        this.armPendingGoToTop();
      }
      return;
    }

    this.clearPendingGoToTop();

    if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, "q")) {
      this.onQuit?.();
      return;
    }

    if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
      this.session.moveSelection(-1);
      return;
    }

    if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
      this.session.moveSelection(1);
      return;
    }

    if (matchesKey(data, Key.left) || matchesKey(data, "h")) {
      void this.session.seekBy(-SEEK_SECONDS);
      return;
    }

    if (matchesKey(data, Key.right) || matchesKey(data, "l")) {
      void this.session.seekBy(SEEK_SECONDS);
      return;
    }

    if (
      matchesKey(data, Key.pageUp)
      || matchesKey(data, Key.ctrl("u"))
      || matchesKey(data, Key.ctrl("b"))
    ) {
      this.session.moveSelectionPage(-1, PAGE_SIZE);
      return;
    }

    if (
      matchesKey(data, Key.pageDown)
      || matchesKey(data, Key.ctrl("d"))
      || matchesKey(data, Key.ctrl("f"))
    ) {
      this.session.moveSelectionPage(1, PAGE_SIZE);
      return;
    }

    if (matchesKey(data, Key.home) || matchesKey(data, "0")) {
      this.session.selectHome();
      return;
    }

    if (matchesKey(data, Key.end) || matchesKey(data, Key.shift("g"))) {
      this.session.selectEnd();
      return;
    }

    if (matchesKey(data, Key.shift("h"))) {
      this.moveSelectionToVisibleAnchor("top");
      return;
    }

    if (matchesKey(data, Key.shift("m"))) {
      this.moveSelectionToVisibleAnchor("middle");
      return;
    }

    if (matchesKey(data, Key.shift("l"))) {
      this.moveSelectionToVisibleAnchor("bottom");
      return;
    }

    if (matchesKey(data, Key.enter)) {
      void this.session.playSelected();
      return;
    }

    if (matchesKey(data, "d")) {
      this.armDeleteConfirmation();
      return;
    }

    if (matchesKey(data, Key.space)) {
      void this.session.togglePause();
      return;
    }

    if (matchesKey(data, "n")) {
      void this.session.playNext();
      return;
    }

    if (matchesKey(data, "p")) {
      void this.session.playPrevious();
      return;
    }

    if (matchesKey(data, "s")) {
      void this.session.stop();
      return;
    }

    if (matchesKey(data, "r")) {
      this.session.toggleLoop();
      return;
    }

    if (matchesKey(data, "x")) {
      this.session.toggleShuffle();
      return;
    }

    if (matchesKey(data, "o")) {
      void this.session.revealSelectedTrack();
      return;
    }

    if (matchesKey(data, "u")) {
      void this.session.undoLastDeletion();
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      this.session.deleteSearchCharacter();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.session.clearSearch();
      return;
    }
  }

  render(width: number) {
    const { playlist } = this.snapshot;
    const visibleIndices = this.snapshot.searchQuery
      ? findTrackIndicesByQuery(playlist, this.snapshot.searchQuery)
      : playlist.map((_, index) => index);
    const selectedVisibleIndex = Math.max(
      0,
      visibleIndices.indexOf(this.snapshot.selectedIndex),
    );
    const viewportHeight = Math.max(this.getViewportHeight(), RESERVED_ROWS);
    const listHeight = this.getListHeight(viewportHeight);
    const { start, end } = getVisibleTrackRange(
      selectedVisibleIndex,
      visibleIndices.length,
      listHeight,
    );

    const position = formatSeconds(this.snapshot.timePositionSeconds);
    const duration = formatSeconds(this.snapshot.durationSeconds);
    const glyph = STATUS_GLYPH[this.snapshot.status] ?? "·";
    const isIdle = this.snapshot.currentTrack === null;
    const nowPlaying = `${glyph}  ${
      this.snapshot.currentTrack?.title ?? "nothing playing"
    }`;
    const barWidth = Math.max(
      4,
      width - position.length - duration.length - 2,
    );

    const lines: string[] = [
      truncateToWidth(
        isIdle ? style(nowPlaying, DIM) : style(nowPlaying, BOLD + CYAN),
        width,
      ),
      truncateToWidth(
        `${style(position, DIM)} ${progressBar(
          this.snapshot.timePositionSeconds,
          this.snapshot.durationSeconds,
          barWidth,
        )} ${style(duration, DIM)}`,
        width,
      ),
    ];

    if (this.snapshot.errorMessage) {
      lines.push(
        truncateToWidth(style(`✗  ${this.snapshot.errorMessage}`, RED), width),
      );
    } else if (this.deleteConfirmationTrackKey !== null) {
      lines.push(
        truncateToWidth(
          style("delete this beatmap set?  enter/d/y confirm · any key cancel", RED),
          width,
        ),
      );
    } else if (this.searchMode || this.snapshot.searchQuery) {
      lines.push(
        truncateToWidth(
          style(
            `/ ${this.snapshot.searchQuery}${this.searchMode ? "▏" : ""}`,
            CYAN,
          ),
          width,
        ),
      );
    } else {
      lines.push(
        truncateToWidth(
          style(
            `${this.snapshot.selectedIndex + 1}/${Math.max(
              playlist.length,
              1,
            )} · loop ${this.snapshot.loop ? "on" : "off"} · shuffle ${
              this.snapshot.shuffle ? "on" : "off"
            } · ${
              this.snapshot.backendName
            }`,
            DIM,
          ),
          width,
        ),
      );
    }

    if (playlist.length === 0) {
      lines.push(
        truncateToWidth("No tracks were found in your osu!lazer library.", width),
      );
    } else if (visibleIndices.length === 0) {
      lines.push(truncateToWidth("No tracks match the current search.", width));
    } else {
      for (let visibleIndex = start; visibleIndex < end; visibleIndex += 1) {
        const index = visibleIndices[visibleIndex];
        if (index === undefined) {
          continue;
        }
        const track = playlist[index];
        if (!track) {
          continue;
        }

        const isCurrent = index === this.snapshot.currentIndex;
        const isSelected = index === this.snapshot.selectedIndex;
        const marker = isCurrent ? "▶" : " ";
        const line = ` ${marker}  ${padIndex(index, playlist.length)}  ${track.title}`;
        lines.push(
          truncateToWidth(
            isSelected
              ? style(line, INVERSE)
              : isCurrent
                ? style(line, CYAN)
                : line,
            width,
          ),
        );
      }
    }

    while (lines.length < viewportHeight - 1) {
      lines.push("");
    }

    lines.push(
      truncateToWidth(
        style(
          this.searchMode
            ? "type to filter · ↑/↓ results · enter play · ctrl-w word · esc leave"
            : "j/k move · ⏎ play · space pause · n/p track · h/l seek · x shuffle · r loop · o reveal · d delete · u undo · / search · q quit",
          DIM,
        ),
        width,
      ),
    );

    return lines;
  }

  private armPendingGoToTop() {
    this.pendingGoToTop = true;
    this.pendingGoToTopTimer = setTimeout(() => {
      this.pendingGoToTop = false;
      this.pendingGoToTopTimer = null;
    }, PENDING_G_TIMEOUT_MS);
  }

  private clearPendingGoToTop() {
    if (this.pendingGoToTopTimer) {
      clearTimeout(this.pendingGoToTopTimer);
      this.pendingGoToTopTimer = null;
    }

    this.pendingGoToTop = false;
  }

  private armDeleteConfirmation() {
    const selectedTrack = this.snapshot.playlist[this.snapshot.selectedIndex];
    if (!selectedTrack) {
      return;
    }

    this.deleteConfirmationTrackKey = selectedTrack.beatmapSetKey;
  }

  private clearDeleteConfirmation() {
    this.deleteConfirmationTrackKey = null;
  }

  private handleDeleteConfirmationInput(data: string) {
    if (
      matchesKey(data, Key.enter)
      || matchesKey(data, "d")
      || matchesKey(data, "y")
    ) {
      this.clearDeleteConfirmation();
      void this.session.deleteSelectedTrack();
      return;
    }

    this.clearDeleteConfirmation();
  }

  private handleSearchInput(data: string) {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.onQuit?.();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.searchMode = false;
      void this.session.playSelected();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.searchMode = false;
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      this.session.deleteSearchCharacter();
      return;
    }

    if (matchesKey(data, Key.ctrl("w"))) {
      this.session.deleteSearchWord();
      return;
    }

    if (matchesKey(data, Key.ctrl("u"))) {
      this.session.clearSearch();
      return;
    }

    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
      this.session.moveSearchSelection(-1);
      return;
    }

    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
      this.session.moveSearchSelection(1);
      return;
    }

    const printable = decodePrintableText(data);
    if (!printable) {
      return;
    }

    this.session.appendSearchQuery(printable);
  }

  private getListHeight(viewportHeight: number) {
    return Math.max(MIN_LIST_ROWS, viewportHeight - RESERVED_ROWS);
  }

  private moveSelectionToVisibleAnchor(
    anchor: "bottom" | "middle" | "top",
  ) {
    if (this.snapshot.playlist.length === 0) {
      return;
    }

    const { start, end } = getVisibleTrackRange(
      this.snapshot.selectedIndex,
      this.snapshot.playlist.length,
      this.getListHeight(Math.max(this.getViewportHeight(), RESERVED_ROWS)),
    );
    const lastVisibleIndex = Math.max(start, end - 1);

    switch (anchor) {
      case "top":
        this.session.setSelectionIndex(start);
        return;
      case "middle":
        this.session.setSelectionIndex(
          start + Math.floor((lastVisibleIndex - start) / 2),
        );
        return;
      case "bottom":
        this.session.setSelectionIndex(lastVisibleIndex);
    }
  }
}
