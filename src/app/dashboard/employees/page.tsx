"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
    Section,
    SectionDescription,
    SectionGroup,
    SectionHeader,
    SectionTitle,
} from "@/components/content/section";
import { EmployeeDataTable } from "@/components/data-table/employees/data-table";
import { EditEmployeeSheet } from "@/components/forms/employees/employee-sheet";
import { FormCard, FormCardContent } from "@/components/forms/form-card";
import type { EmployeeWithPosition } from "@/data/employees";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export default function EmployeesPage() {
    const me = useQuery(api.users.getMe);
    const org = useQuery(api.organizations.getMyOrg);
    const orgId = org?._id;

    const employees = useQuery(api.employees.list, orgId ? { orgId } : "skip") as
        | EmployeeWithPosition[]
        | undefined;

    const removeEmployee = useMutation(api.employees.remove);

    const isAdmin = me?.membership?.role === "admin";

    const [editEmployee, setEditEmployee] = useState<EmployeeWithPosition | null>(
        null,
    );

    async function handleDelete(employeeId: string) {
        await removeEmployee({ employeeId: employeeId as Id<"employees"> });
    }

    return (
        <>
            <SectionGroup>
                <Section>
                    <SectionHeader>
                        <SectionTitle>Employees</SectionTitle>
                        <SectionDescription>
                            Manage your workforce records, positions, and employment history.
                        </SectionDescription>
                    </SectionHeader>
                    <FormCard>
                        <FormCardContent className="p-0">
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
                        </FormCardContent>
                    </FormCard>
                </Section>
            </SectionGroup>

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

