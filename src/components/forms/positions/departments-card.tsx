"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Departments (P12).
 *
 * A department is picked, never typed: this list is what the position form offers. The
 * "normalise" action merges the spellings that predate the list; it never renames one
 * department into another.
 */
export function DepartmentsCard({
  orgId,
  isAdmin,
}: {
  orgId: Id<"organizations">;
  isAdmin: boolean;
}) {
  const departments = useQuery(api.departments.list, { orgId, includeInactive: true });
  const createDepartment = useMutation(api.departments.create);
  const renameDepartment = useMutation(api.departments.rename);
  const setActive = useMutation(api.departments.setActive);
  const normalise = useMutation(api.departments.normaliseNow);
  const [isPending, startTransition] = useTransition();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function run(action: () => Promise<unknown>, success: string) {
    if (!isAdmin) return;
    startTransition(async () => {
      try {
        await action();
        toast.success(success);
      } catch (error) {
        toast.error((error as Error).message ?? "Something went wrong");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-muted-foreground text-xs" htmlFor="dept-name">
            New department
          </label>
          <Input
            id="dept-name"
            className="w-56"
            placeholder="Operations"
            value={newName}
            disabled={!isAdmin || isPending}
            onChange={(event) => setNewName(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          className="gap-2"
          disabled={!isAdmin || isPending || newName.trim().length === 0}
          onClick={() =>
            run(async () => {
              await createDepartment({ orgId, name: newName });
              setNewName("");
            }, "Department added")
          }
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!isAdmin || isPending}
          onClick={() =>
            run(async () => {
              const result = await normalise({ orgId });
              toast.message(
                `${result.departments} department(s), ${result.positionsUpdated} position(s) relinked, ${result.historyUpdated} history row(s) updated`,
              );
            }, "Departments normalised")
          }
        >
          Normalise spellings
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Positions</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(departments ?? []).map((department) => (
              <TableRow key={department._id}>
                <TableCell>
                  {editingId === department._id ? (
                    <Input
                      className="h-8 w-48"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  ) : (
                    department.name
                  )}
                </TableCell>
                <TableCell className="text-right">{department.positionCount}</TableCell>
                <TableCell>
                  {department.isActive ? (
                    <Badge variant="secondary">active</Badge>
                  ) : (
                    <Badge variant="outline">inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isAdmin && editingId === department._id ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={isPending || editName.trim().length === 0}
                        onClick={() =>
                          run(async () => {
                            await renameDepartment({
                              orgId,
                              id: department._id,
                              name: editName,
                            });
                            setEditingId(null);
                          }, "Department renamed")
                        }
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!isAdmin || isPending}
                        onClick={() => {
                          setEditingId(department._id);
                          setEditName(department.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!isAdmin || isPending}
                        onClick={() =>
                          run(
                            () =>
                              setActive({
                                orgId,
                                id: department._id,
                                isActive: !department.isActive,
                              }),
                            department.isActive ? "Department deactivated" : "Department reactivated",
                          )
                        }
                      >
                        {department.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(departments ?? []).length === 0 && (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={4}>
                  No departments yet. Add one here, or press “Normalise spellings” to collect
                  the values already used by positions.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
