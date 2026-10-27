// Sidebar resize constants. The width lives in a CSS custom property on
// :root (not React state) so the pre-paint script can restore it without a
// hydration mismatch and the shadcn sidebar picks it up through
// var(--hrx-sidebar-width, 16rem).
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
export const SIDEBAR_DEFAULT_WIDTH = 256; // shadcn's 16rem
export const SIDEBAR_WIDTH_VAR = "--hrx-sidebar-width";
export const SIDEBAR_STORAGE_KEY = "hrx.sidebarWidth";

export function clampSidebarWidth(width: number): number {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)),
  );
}

/** Runs inline in <body> before paint, so a stored width never flashes. */
export const SIDEBAR_WIDTH_SCRIPT = `try{var w=parseInt(localStorage.getItem("${SIDEBAR_STORAGE_KEY}"),10);if(w&${SIDEBAR_MIN_WIDTH}&&w<=${SIDEBAR_MAX_WIDTH}){document.documentElement.style.setProperty("${SIDEBAR_WIDTH_VAR}",w+"px")}}catch(e){}`;
