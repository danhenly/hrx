"use client";

import { format } from "date-fns";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EmployeeWithPosition } from "@/data/employees";

interface DataTableProps {
  data: EmployeeWithPosition[];
  isAdmin: boolean;
  onEdit: (employee: EmployeeWithPosition) => void;
  onDelete: (employeeId: string) => Promise<void>;
}

const statusLabels: Record<string, string> = {
  active: "Active",
  terminated: "Terminated",
  on_leave: "On Leave",
};

const statusVariants: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  terminated: "destructive",
  on_leave: "secondary",
};

export function EmployeeDataTable({
  data,
  isAdmin,
  onEdit,
  onDelete,
}: DataTableProps) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(employeeId: string, name: string) {
    startTransition(async () => {
      try {
        await onDelete(employeeId);
        toast.success(`${name} removed`);
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to delete employee");
      }
    });
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <UserPlus className="h-10 w-10 opacity-40" />
        <p className="text-sm">No employees yet. Add your first one.</p>
      </div>
    );
  }

  return (
    // overflow-x-visible hands the scroll parent back to ModuleBody so the head sticks.
    <Table containerClassName="overflow-x-visible">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="hover:bg-transparent">
          <TableHead className="caption-style h-(--row-head-height) font-normal text-muted-foreground">
            Name
          </TableHead>
          <TableHead className="caption-style h-(--row-head-height) font-normal text-muted-foreground">
            Contact
          </TableHead>
          <TableHead className="caption-style h-(--row-head-height) font-normal text-muted-foreground">
            Status
          </TableHead>
          <TableHead className="caption-style h-(--row-head-height) font-normal text-muted-foreground">
            Current Position
          </TableHead>
          <TableHead className="caption-style h-(--row-head-height) font-normal text-muted-foreground">
            Department
          </TableHead>
          <TableHead className="caption-style h-(--row-head-height) font-normal text-muted-foreground">
            Hire Date
          </TableHead>
          <TableHead className="caption-style h-(--row-head-height) font-normal text-muted-foreground">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((emp) => (
          <TableRow key={emp._id}>
            <TableCell className="font-medium">
              {emp.firstName} {emp.lastName}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              <div>{emp.email ?? "—"}</div>
              {emp.phone && <div className="text-xs">{emp.phone}</div>}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariants[emp.status] ?? "outline"}>
                {statusLabels[emp.status] ?? emp.status}
              </Badge>
            </TableCell>
            <TableCell>
              {emp.currentPosition?.jobTitle ?? (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {emp.currentPosition?.department ?? (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {format(new Date(emp.hireDate), "MMM d, yyyy")}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onEdit(emp)}
                  aria-label="Edit employee"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {isAdmin && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label="Delete employee"
                        disabled={isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete employee?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently remove{" "}
                          <strong>
                            {emp.firstName} {emp.lastName}
                          </strong>{" "}
                          and all their position history. This action cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() =>
                            handleDelete(
                              emp._id,
                              `${emp.firstName} ${emp.lastName}`,
                            )
                          }
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
