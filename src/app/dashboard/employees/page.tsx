"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { EmployeeDataTable } from "@/components/data-table/employees/data-table";
import { EditEmployeeSheet } from "@/components/forms/employees/employee-sheet";
import {
  ModuleBody,
  ModuleStat,
  ModuleStatFooter,
} from "@/components/layout/module";
import type { EmployeeWithPosition } from "@/data/employees";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export default function EmployeesPage() {
  const { orgId } = useActiveOrg();
  const me = useQuery(api.users.getMe, orgId ? { orgId } : {});

  const employees = useQuery(api.employees.list, orgId ? { orgId } : "skip") as
    | EmployeeWithPosition[]
    | undefined;

  const removeEmployee = useMutation(api.employees.remove);

  const isAdmin = me?.membership?.role === "admin";

  const [editEmployee, setEditEmployee] = useState<EmployeeWithPosition | null>(
    null,
  );

  const counts = useMemo(() => {
    const result = {
      total: employees?.length ?? 0,
      active: 0,
      onLeave: 0,
      terminated: 0,
    };
    for (const employee of employees ?? []) {
      if (employee.status === "active") result.active += 1;
      else if (employee.status === "on_leave") result.onLeave += 1;
      else if (employee.status === "terminated") result.terminated += 1;
    }
    return result;
  }, [employees]);

  async function handleDelete(employeeId: string) {
    await removeEmployee({ employeeId: employeeId as Id<"employees"> });
  }

  return (
    <>
      <ModuleBody>
        {employees === undefined ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Loading employees…
          </div>
        ) : (
          <EmployeeDataTable
            data={employees}
            isAdmin={isAdmin}
            onEdit={setEditEmployee}
            onDelete={handleDelete}
          />
        )}
      </ModuleBody>

      <ModuleStatFooter>
        <ModuleStat value={counts.total} label="employees" />
        <ModuleStat value={counts.active} label="active" />
        <ModuleStat value={counts.onLeave} label="on leave" />
        <ModuleStat value={counts.terminated} label="terminated" />
      </ModuleStatFooter>

      <EditEmployeeSheet
        employee={editEmployee}
        isAdmin={isAdmin}
        open={!!editEmployee}
        onOpenChange={(open) => {
          if (!open) setEditEmployee(null);
        }}
      />
    </>
  );
}
