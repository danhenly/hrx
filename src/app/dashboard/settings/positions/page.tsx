"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { PositionsDataTable } from "@/components/data-table/positions/data-table";
import { DepartmentsCard } from "@/components/forms/positions/departments-card";
import { FormPosition } from "@/components/forms/positions/form-position";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PositionWithUsage } from "@/data/positions";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default function PositionsPage() {
  const { orgId } = useActiveOrg();
  const me = useQuery(api.users.getMe, orgId ? { orgId } : {});
  const positions = useQuery(
    api.positions.list,
    orgId ? { orgId, includeInactive: true } : "skip",
  ) as PositionWithUsage[] | undefined;
  const setActive = useMutation(api.positions.setActive);
  const [isPending, startTransition] = useTransition();
  const isAdmin = me?.membership?.role === "admin";

  const [addOpen, setAddOpen] = useState(false);
  const [editPosition, setEditPosition] = useState<PositionWithUsage | null>(
    null,
  );

  function handleSetActive(positionId: string, isActive: boolean) {
    if (!isAdmin) return;
    startTransition(async () => {
      try {
        await setActive({
          positionId: positionId as Id<"positions">,
          isActive,
        });
        toast.success(
          isActive ? "Position reactivated" : "Position deactivated",
        );
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to change position");
      }
    });
  }

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>Positions</SectionTitle>
          <SectionDescription>
            Maintain the job-title masterlist used by employee records.
          </SectionDescription>
          <div className="ml-auto">
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              disabled={!orgId}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add position
            </Button>
          </div>
        </SectionHeader>
        {positions === undefined ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Loading positions…
          </div>
        ) : (
          <PositionsDataTable
            data={positions}
            isAdmin={isAdmin}
            onEdit={setEditPosition}
            onSetActive={handleSetActive}
          />
        )}
        {isPending && (
          <div className="text-muted-foreground text-xs">Working…</div>
        )}
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>Departments</SectionTitle>
          <SectionDescription>
            The list the position form offers. Renaming a department updates the positions that
            point at it; history rows keep the name they were recorded with.
          </SectionDescription>
        </SectionHeader>
        {orgId ? (
          <DepartmentsCard orgId={orgId} isAdmin={isAdmin} />
        ) : (
          <p className="text-muted-foreground text-sm">Select an organisation.</p>
        )}
      </Section>

      <Sheet open={addOpen} onOpenChange={setAddOpen} modal={false}>
        <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
          <SheetHeader className="sticky top-0 border-b bg-background pb-4">
            <SheetTitle>Add Position</SheetTitle>
            <SheetDescription>
              Add a job title to the org's masterlist.
            </SheetDescription>
          </SheetHeader>
          {orgId && (
            <FormPosition orgId={orgId} onDone={() => setAddOpen(false)} />
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editPosition !== null}
        onOpenChange={(open) => !open && setEditPosition(null)}
        modal={false}
      >
        <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
          <SheetHeader className="sticky top-0 border-b bg-background pb-4">
            <SheetTitle>Edit Position</SheetTitle>
            <SheetDescription>
              Renaming does not change what past records say.
            </SheetDescription>
          </SheetHeader>
          {orgId && editPosition && (
            <FormPosition
              orgId={orgId}
              positionId={editPosition._id}
              defaultValues={{
                name: editPosition.name,
                departmentId: editPosition.departmentId,
                department: editPosition.department,
                description: editPosition.description,
              }}
              onDone={() => setEditPosition(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </SectionGroup>
  );
}
