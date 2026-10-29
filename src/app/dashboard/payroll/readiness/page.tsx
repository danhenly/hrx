"use client";

import { useQuery } from "convex/react";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { Badge } from "@/components/ui/badge";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../../convex/_generated/api";

/**
 * Readiness audit (P9).
 *
 * Every row is a fact read from this org's data. Blockers stop payday; warnings are
 * things a human should look at before approving a run.
 */
export default function PayrollReadinessPage() {
  const { orgId } = useActiveOrg();
  const report = useQuery(
    api.payroll.readiness.audit,
    orgId ? { orgId } : "skip",
  );

  if (!orgId) {
    return (
      <p className="text-muted-foreground text-sm">Select an organisation.</p>
    );
  }

  return (
    <SectionGroup width="wide">
      <Section>
        <SectionHeader>
          <SectionTitle>Payroll readiness</SectionTitle>
          <SectionDescription>
            What still stands between this organisation and a correct first live
            run.
          </SectionDescription>
        </SectionHeader>

        {report === undefined && (
          <p className="text-muted-foreground text-sm">Checking…</p>
        )}

        {report && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={report.ready ? "secondary" : "destructive"}>
                {report.ready
                  ? "ready for a live run"
                  : `${report.blockerCount} blocker(s)`}
              </Badge>
              <span className="text-muted-foreground">
                {report.employees} active employee(s)
              </span>
            </div>

            <div className="space-y-6">
              {[
                {
                  label: "Blockers",
                  items: report.blockers,
                  tone: "destructive" as const,
                },
                {
                  label: "Warnings",
                  items: report.warnings,
                  tone: "outline" as const,
                },
              ].map((group) => (
                <div key={group.label}>
                  <p className="mb-2 font-medium text-sm">
                    {group.label} ({group.items.length})
                  </p>
                  {group.items.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Nothing outstanding.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {group.items.map((item) => (
                        <li key={item.id} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={group.tone}>{item.severity}</Badge>
                            <span className="font-medium text-sm">
                              {item.title}
                            </span>
                          </div>
                          <p className="mt-1 text-muted-foreground text-xs">
                            {item.detail}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            Fix: {item.fix}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              <div>
                <p className="mb-2 font-medium text-sm">Everything checked</p>
                <ul className="space-y-1 text-muted-foreground text-xs">
                  {report.items.map((item) => (
                    <li key={item.id}>
                      {item.count > 0 ? "✗" : "✓"} {item.title}
                      {item.count > 0 ? ` — ${item.count}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </Section>
    </SectionGroup>
  );
}
