"use client";

import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FormStatutoryTable, type StatutoryRowDraft } from "./form-statutory-table";

/**
 * The practitioner's view of the statutory tables (D17): what is in force, what is
 * coming, when it takes effect and where it was published. Editing is admin-only,
 * and every save is audited.
 */

const KIND_LABELS: Record<string, string> = {
  sss: "SSS contributions",
  philhealth: "PhilHealth premiums",
  pagibig: "Pag-IBIG contributions",
  tax: "BIR withholding tax",
  deminimis: "De minimis ceilings",
  holiday: "Holiday calendar",
};

const KIND_ORDER = ["sss", "philhealth", "pagibig", "tax", "deminimis", "holiday"];

const manilaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function StatutoryTables({
  orgId,
  isAdmin,
}: {
  orgId: Id<"organizations">;
  isAdmin: boolean;
}) {
  const rows = useQuery(api.payroll.statutoryTables.list, { orgId });
  const [draft, setDraft] = useState<StatutoryRowDraft | null>(null);

  if (rows === undefined) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Loading statutory tables…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm">
        <p className="font-medium">No statutory tables yet.</p>
        <p className="text-muted-foreground">
          Seed them once from the checked-in mirror of plan §2 (P0.2):
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 font-mono text-xs">
          {`npx convex run payroll/seedStatutory:seedStatutoryTables '{"orgId":"${orgId}","actorId":"<admin user id>"}'`}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {KIND_ORDER.filter((kind) => rows.some((row) => row.kind === kind)).map(
        (kind) => {
          const kindRows = rows.filter((row) => row.kind === kind);
          return (
            <div key={kind} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">{KIND_LABELS[kind] ?? kind}</h3>
                {isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      const latest = kindRows[kindRows.length - 1];
                      const nextYear = new Date(
                        latest ? latest.effectiveFrom + 366 * 24 * 3600 * 1000 : Date.now(),
                      );
                      setDraft({
                        kind: kind as StatutoryRowDraft["kind"],
                        effectiveFrom: manilaDate.format(nextYear),
                        payload: latest?.payload ?? {},
                        source: latest?.source ?? "",
                      });
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Enter future table
                  </Button>
                )}
              </div>
              <div className="divide-y rounded-md border">
                {kindRows.map((row) => (
                  <div
                    key={row._id}
                    className="flex items-start justify-between gap-3 p-3 text-sm"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          from {manilaDate.format(new Date(row.effectiveFrom))}
                          {row.effectiveTo
                            ? ` → ${manilaDate.format(new Date(row.effectiveTo))}`
                            : " → open"}
                        </span>
                        {row.inForce && <Badge className="text-xs">In force</Badge>}
                        {row.upcoming && (
                          <Badge variant="secondary" className="text-xs">
                            Upcoming
                          </Badge>
                        )}
                        {!row.inForce && !row.upcoming && (
                          <Badge variant="outline" className="text-xs">
                            Superseded
                          </Badge>
                        )}
                      </div>
                      <p className="max-w-2xl text-muted-foreground text-xs">
                        {row.source}
                      </p>
                    </div>
                    {isAdmin && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDraft({
                            kind: row.kind as StatutoryRowDraft["kind"],
                            effectiveFrom: manilaDate.format(new Date(row.effectiveFrom)),
                            effectiveTo: row.effectiveTo
                              ? manilaDate.format(new Date(row.effectiveTo))
                              : undefined,
                            payload: row.payload,
                            source: row.source,
                          })
                        }
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        },
      )}

      <Sheet
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        modal={false}
      >
        <SheetContent className="w-[560px] overflow-y-auto sm:max-w-[560px]">
          <SheetHeader className="sticky top-0 border-b bg-background pb-4">
            <SheetTitle>
              {draft ? (KIND_LABELS[draft.kind] ?? draft.kind) : "Statutory table"}
            </SheetTitle>
            <SheetDescription>
              Ranges for one kind may not overlap, and the source is required.
              Saving closes the previous table at your effective date.
            </SheetDescription>
          </SheetHeader>
          {draft && (
            <FormStatutoryTable
              orgId={orgId}
              draft={draft}
              onDone={() => setDraft(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
