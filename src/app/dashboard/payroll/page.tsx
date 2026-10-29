"use client";

import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { PayrollRegister } from "@/components/forms/payroll/payroll-register";
import { useActiveOrg } from "@/providers/org-provider";

/**
 * The payroll register (P3.3).
 *
 * Periods on the left of the flow, runs on the right: compute → review → approve.
 * Nothing here edits a payslip — approving freezes the register (D2), and the only
 * correction paths are an adjustment on the next period or a void + new version.
 */
export default function PayrollPage() {
  const { orgId } = useActiveOrg();

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>Payroll</SectionTitle>
          <SectionDescription>
            A run is computed for a period, reviewed, then approved by an admin.
            An approved run is frozen — corrections go to the next period as
            adjustments or to a new version.
          </SectionDescription>
        </SectionHeader>
        <div className="mb-4 flex flex-wrap gap-2">
          <a
            className="text-sm underline underline-offset-4"
            href="/dashboard/payroll/year-end"
          >
            Year end &amp; alphalist
          </a>
        </div>
        {orgId ? (
          <PayrollRegister orgId={orgId} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Select an organisation.
          </p>
        )}
      </Section>
    </SectionGroup>
  );
}
