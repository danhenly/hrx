"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Timesheet } from "@/data/timekeeping";
import { timesheetColumns } from "./columns";

interface TimesheetsDataTableProps {
  timesheets: Timesheet[];
  employeesById: Record<string, string>;
  activeId?: string;
  onOpen: (timesheet: Timesheet) => void;
}

export function TimesheetsDataTable({
  timesheets,
  employeesById,
  activeId,
  onOpen,
}: TimesheetsDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "weekStart", desc: true },
  ]);

  const columns = useMemo(
    () => timesheetColumns(employeesById),
    [employeesById],
  );

  const table = useReactTable({
    data: timesheets,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    // overflow-x-visible hands the scroll parent back to ModuleBody, which is
    // what lets the header stick; a scrollable wrapper would trap it.
    <Table containerClassName="overflow-x-visible">
      <TableHeader className="sticky top-0 z-10 bg-background">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const canSort = header.column.getCanSort();
              return (
                <TableHead
                  key={header.id}
                  className="caption-style h-(--row-head-height) text-muted-foreground"
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-1"
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <ArrowUpDown aria-hidden className="size-3 opacity-50" />
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={activeId === row.original._id ? "selected" : undefined}
            onClick={() => onOpen(row.original)}
            className="h-(--row-height) cursor-pointer hover:bg-muted/40 data-[state=selected]:bg-muted"
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className="h-(--row-height)">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {table.getRowModel().rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={columns.length}
              className="h-[120px] text-center text-muted-foreground text-xs"
            >
              No timesheets for this week.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
