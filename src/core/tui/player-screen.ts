import {
  type Component,
  decodeKittyPrintable,
  Key,
  matchesKey,
  truncateToWidth,
} from "@mariozechner/pi-tui";

import type { PlaylistPlayerSession } from "../player/mod.js";
import type { PlaylistPlayerSnapshot } from "../player/types.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const INVERSE = "\x1b[7m";

const MIN_LIST_ROWS = 4;
const RESERVED_ROWS = 6;
const PAGE_SIZE = 10;
const PENDING_G_TIMEOUT_MS = 400;

function style(text: string, code: string) {
  return `${code}${text}${RESET}`;
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

    if (matchesKey(data, Key.space)) {
      void this.session.togglePause();
      return;
    }

    if (matchesKey(data, "n") || matchesKey(data, Key.right)) {
      void this.session.playNext();
      return;
    }

    if (matchesKey(data, "p") || matchesKey(data, Key.left)) {
      void this.session.playPrevious();
      return;
    }

    if (matchesKey(data, "s")) {
      void this.session.stop();
      return;
    }

    if (matchesKey(data, "l")) {
      this.session.toggleLoop();
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
    const viewportHeight = Math.max(this.getViewportHeight(), RESERVED_ROWS);
    const listHeight = this.getListHeight(viewportHeight);
    const { start, end } = getVisibleTrackRange(
      this.snapshot.selectedIndex,
      playlist.length,
      listHeight,
    );

    const lines: string[] = [
      truncateToWidth(
        `osu-play | tracks ${playlist.length} | backend ${this.snapshot.backendName} | loop ${
          this.snapshot.loop ? "on" : "off"
        }`,
        width,
      ),
      truncateToWidth(
        style(
          `now ${this.snapshot.status}: ${
            this.snapshot.currentTrack?.title ?? "nothing selected"
          }`,
          CYAN,
        ),
        width,
      ),
      truncateToWidth(
        style(
          `${formatSeconds(this.snapshot.timePositionSeconds)} / ${formatSeconds(
            this.snapshot.durationSeconds,
          )} | selected ${this.snapshot.selectedIndex + 1}/${Math.max(
            playlist.length,
            1,
          )}${
            this.snapshot.searchQuery
              ? ` | search "${this.snapshot.searchQuery}"${
                  this.searchMode ? " [input]" : ""
                }`
              : this.searchMode
                ? " | search [input]"
              : ""
          }`,
          DIM,
        ),
        width,
      ),
    ];

    if (this.snapshot.errorMessage) {
      lines.push(
        truncateToWidth(
          style(`error: ${this.snapshot.errorMessage}`, RED),
          width,
        ),
      );
    } else {
      lines.push("");
    }

    if (playlist.length === 0) {
      lines.push(
        truncateToWidth("No tracks were found in your osu!lazer library.", width),
      );
    } else {
      for (let index = start; index < end; index += 1) {
        const track = playlist[index];
        if (!track) {
          continue;
        }

        const isCurrent = index === this.snapshot.currentIndex;
        const isSelected = index === this.snapshot.selectedIndex;
        const prefix = `${isSelected ? ">" : " "} ${isCurrent ? "*" : " "} `;
        const line = `${prefix}${padIndex(index, playlist.length)}. ${track.title}`;
        lines.push(
          truncateToWidth(
            isSelected ? style(line, INVERSE) : line,
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
            ? "/ search | type to jump | backspace edit | enter keep | esc leave"
            : "j/k wrap | gg/G bounds | C-u/C-d page | H/M/L viewport | / search | enter play | q quit",
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

  private handleSearchInput(data: string) {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.onQuit?.();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.searchMode = false;
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

    if (matchesKey(data, Key.ctrl("u"))) {
      this.session.clearSearch();
      return;
    }

    const printable = decodePrintableText(data);
    if (!printable || printable === " ") {
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
