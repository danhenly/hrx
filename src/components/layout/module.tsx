import { cn } from "@/lib/utils";

/**
 * Wide data-module frame: a full-height, non-scrolling column.
 * The module owns its own scroll region (ModuleBody) so the page itself never
 * scrolls — that is what keeps the app header and the table head in place.
 */
export function ModuleFrame({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-svh min-h-0 w-full flex-col overflow-hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** The single scroll region of a module. Never nest a page scroll inside it. */
export function ModuleBody({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-auto", className)} {...props}>
      {children}
    </div>
  );
}

/** Flat filter/action band: filters left, primary action right. No card. */
export function ModuleToolbar({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-(--page-gutter) py-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Summary strip beneath a table. Cells are separated by 1px of border colour
 * (gap-px over bg-border), not by outlines on each cell.
 */
export function ModuleStatFooter({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "caption-style grid shrink-0 auto-cols-fr grid-flow-col gap-px overflow-x-auto border-t bg-border p-px",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModuleStat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 whitespace-nowrap bg-background px-3 py-3",
        className,
      )}
    >
      <span className="text-foreground tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

/** Sticky tab row beneath the app header (status vocabulary lives here, not in a card). */
export function ModuleTabs({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("shrink-0 border-b px-(--page-gutter)", className)}>
      {children}
    </div>
  );
}
