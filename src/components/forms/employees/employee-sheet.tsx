"use client";

import { useMutation, useQuery } from "convex/react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EmployeeWithPosition } from "@/data/employees";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
    type EmployeeProfileValues,
    FormEmployeeProfile,
} from "./form-employee-profile";
import { FormPositionHistory } from "./form-position-history";

// ─── Add Employee Sheet ─────────────────────────────────────────────────────

interface AddEmployeeSheetProps {
    orgId: Id<"organizations">;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AddEmployeeSheet({
    orgId,
    open,
    onOpenChange,
}: AddEmployeeSheetProps) {
    const createEmployee = useMutation(api.employees.create);

    async function handleSubmit(values: EmployeeProfileValues) {
        await createEmployee({
            orgId,
            firstName: values.firstName,
            lastName: values.lastName,
            email: values.email || undefined,
            phone: values.phone || undefined,
            dateOfBirth: values.dateOfBirth?.getTime(),
            hireDate: values.hireDate.getTime(),
            status: values.status,
        });
        onOpenChange(false);
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
            <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
                <SheetHeader className="sticky top-0 border-b bg-background pb-4">
                    <SheetTitle>Add Employee</SheetTitle>
                    <SheetDescription>
                        Create a new employee record in your organisation.
                    </SheetDescription>
                </SheetHeader>
                <FormEmployeeProfile
                    onSubmit={handleSubmit}
                    submitLabel="Add Employee"
                />
            </SheetContent>
        </Sheet>
    );
}

// ─── Edit Employee Sheet ────────────────────────────────────────────────────

interface EditEmployeeSheetProps {
    employee: EmployeeWithPosition | null;
    isAdmin: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function EditEmployeeSheetContent({
    employee,
    isAdmin,
    onOpenChange,
}: {
    employee: EmployeeWithPosition;
    isAdmin: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const updateEmployee = useMutation(api.employees.update);
    // Fetch full position history for the edit sheet
    const detail = useQuery(api.employees.get, {
        employeeId: employee._id as Id<"employees">,
    });

    async function handleSubmit(values: EmployeeProfileValues) {
        await updateEmployee({
            employeeId: employee._id as Id<"employees">,
            firstName: values.firstName,
            lastName: values.lastName,
            email: values.email || undefined,
            phone: values.phone || undefined,
            dateOfBirth: values.dateOfBirth?.getTime(),
            hireDate: values.hireDate.getTime(),
            status: values.status,
        });
        onOpenChange(false);
    }

    return (
        <Tabs defaultValue="profile">
            <TabsList className="mx-4 my-4 w-[calc(100%-2rem)]">
                <TabsTrigger value="profile" className="flex-1">
                    Profile
                </TabsTrigger>
                <TabsTrigger value="positions" className="flex-1">
                    Position History
                </TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
                <FormEmployeeProfile
                    defaultValues={employee}
                    onSubmit={handleSubmit}
                    submitLabel="Save Changes"
                />
            </TabsContent>

            <TabsContent value="positions">
                {!detail ? (
                    <div className="space-y-3 px-4 py-4">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                    </div>
                ) : (
                    <FormPositionHistory
                        employeeId={employee._id as Id<"employees">}
                        positions={detail.positions}
                        isAdmin={isAdmin}
                    />
                )}
            </TabsContent>
        </Tabs>
    );
}

export function EditEmployeeSheet({
    employee,
    isAdmin,
    open,
    onOpenChange,
}: EditEmployeeSheetProps) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
            <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
                <SheetHeader className="sticky top-0 border-b bg-background pb-4">
                    <SheetTitle>
                        {employee
                            ? `${employee.firstName} ${employee.lastName}`
                            : "Edit Employee"}
                    </SheetTitle>
                    <SheetDescription>
                        Update profile and manage position history.
                    </SheetDescription>
                </SheetHeader>
                {employee && (
                    <EditEmployeeSheetContent
                        employee={employee}
                        isAdmin={isAdmin}
                        onOpenChange={onOpenChange}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}
