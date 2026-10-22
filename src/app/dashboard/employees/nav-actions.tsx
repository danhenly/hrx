"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { AddEmployeeSheet } from "@/components/forms/employees/employee-sheet";
import { Button } from "@/components/ui/button";
import { useActiveOrg } from "@/providers/org-provider";

export function NavActions() {
    const { orgId } = useActiveOrg();
    const [open, setOpen] = useState(false);

    return (
        <>
            <div className="flex items-center gap-2 text-sm">
                <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
                    <UserPlus className="h-4 w-4" />
                    Add Employee
                </Button>
            </div>

            {orgId && (
                <AddEmployeeSheet orgId={orgId} open={open} onOpenChange={setOpen} />
            )}
        </>
    );
}
