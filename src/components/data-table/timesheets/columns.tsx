import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TIMESHEET_STATUS_LABELS, type Timesheet } from "@/data/timekeeping";
import { formatDuration, formatWeekRange } from "@/lib/week-display";

/**
 * Timesheet rows. The `actions` column is intentionally empty: submit/approve
 * controls belong to the lifecycle work (S2), which replaces the mutations
 * behind them. Keeping the column means S2 adds a cell, not a column set.
 */
export function timesheetColumns(
  employeesById: Record<string, string>,
  renderActions?: (timesheet: Timesheet) => React.ReactNode,
): ColumnDef<Timesheet>[] {
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
          aria-label="Select all timesheets"
        />
      ),
      enableSorting: false,
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${employeesById[row.original.employeeId] ?? "timesheet"}`}
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
      accessorKey: "weekStart",
      header: "Week",
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {formatWeekRange(row.original.weekStart)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="outline">
          {TIMESHEET_STATUS_LABELS[row.original.status]}
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
