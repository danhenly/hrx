"use client";

import { useParams } from "next/navigation";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { GovFormsPanel } from "@/components/payroll/gov-forms-panel";
import { useActiveOrg } from "@/providers/org-provider";
import type { Id } from "../../../../../../convex/_generated/dataModel";

/**
 * Government schedules for one run (P6).
 *
 * Read-only: a form is a restatement of an approved register, never an editor.
 */
export default function PayrollFormsPage() {
  const { orgId } = useActiveOrg();
  const params = useParams<{ runId: string }>();

  return (
    <SectionGroup width="wide">
      <Section>
        <SectionHeader>
          <SectionTitle>Government schedules</SectionTitle>
          <SectionDescription>
            SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF and the BIR 1601-C figures for this run.
            Every schedule carries the statutory table version it was produced under.
          </SectionDescription>
        </SectionHeader>
        {orgId && params?.runId ? (
          <GovFormsPanel orgId={orgId} runId={params.runId as Id<"payrollRuns">} />
        ) : (
          <p className="text-muted-foreground text-sm">Select an organisation.</p>
        )}
      </Section>
    </SectionGroup>
  );
}
