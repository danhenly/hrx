"use client";

import Link from "next/link";
import { addDays, format } from "date-fns";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import {
    Section,
    SectionDescription,
    SectionGroup,
    SectionHeader,
    SectionTitle,
} from "@/components/content/section";
import { FormCard, FormCardContent } from "@/components/forms/form-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@/data/employees";
import type { Timesheet } from "@/data/timekeeping";
import { api } from "../../../../convex/_generated/api";

const STATUS_SUMMARY = [
    {
        key: "open",
        label: "Draft",
        description: "Being filled out or still editable.",
    },
    {
        key: "submitted",
        label: "Submitted",
        description: "Awaiting approval from administrators.",
    },
    {
        key: "approved",
        label: "Approved",
        description: "Finalized and locked in the ledger.",
    },
];

export default function TimePage() {
    const org = useQuery(api.organizations.getMyOrg);
    const orgId = org?._id;

    const timesheets = useQuery(
        api.timesheets.listForOrg,
        orgId ? { orgId } : "skip",
    ) as Timesheet[] | undefined;
    const employees = useQuery(api.employees.list, orgId ? { orgId } : "skip") as
        | Employee[]
        | undefined;

    const employeesById = useMemo(() => {
        if (!employees) return {};
        return employees.reduce<Record<string, string>>((acc, employee) => {
            acc[employee._id] = `${employee.firstName} ${employee.lastName}`;
            return acc;
        }, {});
    }, [employees]);

    const grouped = useMemo(() => {
        if (!timesheets) return [];
        return STATUS_SUMMARY.map((status) => ({
            ...status,
            items: timesheets.filter((sheet) => sheet.status === status.key),
        }));
    }, [timesheets]);

    const isLoading = !orgId || !timesheets || !employees;

    return (
        <SectionGroup>
            <Section>
                <SectionHeader className="sm:flex-row sm:items-center sm:justify-between">
                    <SectionTitle>Timesheets</SectionTitle>
                    <Button size="sm" variant="secondary" asChild>
                        <Link href="/dashboard/time/entries">Log time entries</Link>
                    </Button>
                </SectionHeader>
                <FormCard>
                    <FormCardContent className="space-y-6">
                        {isLoading ? (
                            <div className="space-y-3">
                                <Skeleton className="h-5 w-40" />
                                <Skeleton className="h-48 w-full" />
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="grid gap-4 md:grid-cols-3">
                                    {grouped.map((group) => (
                                        <div key={group.key} className="rounded-lg border p-4">
                                            <div className="flex items-center justify-between gap-4">
                                                <div>
                                                    <p className="text-sm font-semibold">{group.label}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {group.description}
                                                    </p>
                                                </div>
                                                <Badge variant="outline">{group.items.length} rows</Badge>
                                            </div>
                                            <ul className="mt-4 space-y-3 text-sm">
                                                {group.items.slice(0, 3).map((row) => (
                                                    <li
                                                        key={row._id}
                                                        className="flex items-center justify-between gap-3"
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">
                                                                {employeesById[row.employeeId] ?? "Unknown"}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {formatWeekRange(row.weekStart)}
                                                            </span>
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">
                                                            {formatDuration(row.totalMinutes)}
                                                        </span>
                                                    </li>
                                                ))}
                                                {group.items.length === 0 ? (
                                                    <p className="text-xs text-muted-foreground">
                                                        No {group.label.toLowerCase()} timesheets.
                                                    </p>
                                                ) : group.items.length > 3 ? (
                                                    <p className="text-xs text-muted-foreground">
                                                        Showing 3 of {group.items.length}
                                                    </p>
                                                ) : null}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </FormCardContent>
                </FormCard>
            </Section>
        </SectionGroup>
    );
}

function formatWeekRange(weekStart: number) {
    const start = new Date(weekStart);
    const end = addDays(start, 6);
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

function formatDuration(minutes: number | undefined) {
    const total = minutes ?? 0;
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    return `${hours}h ${remainder}m`;
}
