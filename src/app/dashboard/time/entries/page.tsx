"use client";

import Link from "next/link";
import { endOfWeek, startOfWeek } from "date-fns";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
    Section,
    SectionDescription,
    SectionGroup,
    SectionHeader,
    SectionTitle,
} from "@/components/content/section";
import { FormCard, FormCardContent } from "@/components/forms/form-card";
import { ManualEntryGrid } from "@/components/forms/timekeeping/manual-entry-grid";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@/data/employees";
import type { TimeEntry } from "@/data/timekeeping";
import { api } from "../../../../../convex/_generated/api";

export default function TimeEntriesPage() {
    const org = useQuery(api.organizations.getMyOrg);
    const orgId = org?._id;

    const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());

    const weekStart = useMemo(() => startOfWeek(anchorDate, { weekStartsOn: 1 }), [anchorDate]);
    const weekEnd = useMemo(() => endOfWeek(anchorDate, { weekStartsOn: 1 }), [anchorDate]);

    const employees = useQuery(api.employees.list, orgId ? { orgId } : "skip") as
        | Employee[]
        | undefined;

    const entries = useQuery(
        api.timeEntries.listByDateRange,
        orgId
            ? {
                orgId,
                startDate: weekStart.getTime(),
                endDate: weekEnd.getTime(),
            }
            : "skip",
    ) as TimeEntry[] | undefined;

    function handleWeekChange(date: Date) {
        setAnchorDate(startOfWeek(date, { weekStartsOn: 1 }));
    }

    const isLoading = !orgId || entries === undefined || employees === undefined;

    return (
        <SectionGroup>
            <Section>
                <SectionHeader className="sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <SectionTitle>Manual entries</SectionTitle>
                        <SectionDescription>
                            Use this form to draft or resubmit daily time entries. For an overview of your
                            timesheets, head back to the main time page.
                        </SectionDescription>
                    </div>
                    <Button size="sm" variant="outline" asChild>
                        <Link href="/dashboard/time">View timesheets</Link>
                    </Button>
                </SectionHeader>
                <FormCard>
                    <FormCardContent className="p-4">
                        {isLoading ? (
                            <div className="space-y-3">
                                <Skeleton className="h-6 w-64" />
                                <Skeleton className="h-48 w-full" />
                            </div>
                        ) : (
                            <ManualEntryGrid
                                orgId={orgId}
                                employees={employees}
                                entries={entries}
                                weekStart={weekStart}
                                weekEnd={weekEnd}
                                onWeekChange={handleWeekChange}
                            />
                        )}
                    </FormCardContent>
                </FormCard>
            </Section>
        </SectionGroup>
    );
}
