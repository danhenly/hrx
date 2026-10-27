import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ENTRY_STATUS_LABELS, type TimeEntry } from "@/data/timekeeping";
import { formatDay, formatDuration } from "@/lib/week-display";

/**
 * One row per employee-day. The `actions` cell is supplied by the page so the
 * table never re-implements a permission check the server already owns.
 */
export function timesheetColumns(
  employeesById: Record<string, string>,
  renderActions?: (entry: TimeEntry) => React.ReactNode,
): ColumnDef<TimeEntry>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all entries"
        />
      ),
      enableSorting: false,
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${employeesById[row.original.employeeId] ?? "entry"}`}
        />
      ),
    },
    {
      accessorKey: "employeeId",
      id: "employee",
      header: "Employee",
      sortingFn: (a, b) =>
        (employeesById[a.original.employeeId] ?? "").localeCompare(
          employeesById[b.original.employeeId] ?? "",
        ),
      cell: ({ row }) => (
        <span className="block max-w-[220px] truncate font-medium">
          {employeesById[row.original.employeeId] ?? "Unknown"}
        </span>
      ),
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {formatDay(row.original.date)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="outline">
          {ENTRY_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: "totalMinutes",
      header: () => <div className="text-right">Logged</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {formatDuration(row.original.totalMinutes)}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          {renderActions?.(row.original)}
        </div>
      ),
    },
  ];
}
