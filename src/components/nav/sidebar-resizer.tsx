"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_STORAGE_KEY,
  SIDEBAR_WIDTH_VAR,
} from "@/lib/sidebar";

const KEYBOARD_STEP = 10;

const listeners = new Set<() => void>();
let currentWidth: number | null = null;

function readWidth(): number {
  if (currentWidth === null) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      SIDEBAR_WIDTH_VAR,
    );
    const parsed = Number.parseInt(raw, 10);
    currentWidth = Number.isNaN(parsed)
      ? SIDEBAR_DEFAULT_WIDTH
      : clampSidebarWidth(parsed);
  }
  return currentWidth;
}

function applyWidth(width: number) {
  currentWidth = clampSidebarWidth(width);
  document.documentElement.style.setProperty(
    SIDEBAR_WIDTH_VAR,
    `${currentWidth}px`,
  );
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(readWidth()));
  } catch {
    // Private mode / storage disabled: resizing still works for the session.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Drag handle on the sidebar's trailing edge. Width is applied to a root CSS
 * variable, so the shadcn sidebar follows it without re-rendering the tree.
 */
export function SidebarResizer() {
  const width = useSyncExternalStore(
    subscribe,
    readWidth,
    () => SIDEBAR_DEFAULT_WIDTH,
  );
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  // Drop the cached width with the tree so a remount re-reads the DOM.
  useEffect(() => {
    return () => {
      currentWidth = null;
    };
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: readWidth() };
    document.documentElement.dataset.sidebarResizing = "";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    applyWidth(drag.current.startWidth + event.clientX - drag.current.startX);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    delete document.documentElement.dataset.sidebarResizing;
    persist();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next: Record<string, number> = {
      ArrowLeft: width - KEYBOARD_STEP,
      ArrowRight: width + KEYBOARD_STEP,
      Home: SIDEBAR_MIN_WIDTH,
      End: SIDEBAR_MAX_WIDTH,
    };
    if (event.key === "Enter") {
      event.preventDefault();
      applyWidth(SIDEBAR_DEFAULT_WIDTH);
      persist();
      return;
    }
    if (!(event.key in next)) return;
    event.preventDefault();
    applyWidth(next[event.key]);
    persist();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={() => {
        applyWidth(SIDEBAR_DEFAULT_WIDTH);
        persist();
      }}
      onKeyDown={handleKeyDown}
      className="group/resizer -right-1 absolute inset-y-0 z-20 hidden w-2 cursor-col-resize touch-none select-none outline-none group-data-[collapsible=icon]:hidden md:block"
    >
      <span
        aria-hidden
        className="-translate-x-1/2 absolute inset-y-0 left-1/2 w-px bg-transparent transition-colors duration-150 group-hover/resizer:bg-border group-focus-visible/resizer:bg-primary/60 group-active/resizer:bg-primary/60"
      />
    </div>
  );
}
