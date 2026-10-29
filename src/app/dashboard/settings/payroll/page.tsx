"use client";

import { useQuery } from "convex/react";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { FormPayrollSettings } from "@/components/forms/payroll/form-payroll-settings";
import { StatutoryTables } from "@/components/forms/payroll/statutory-tables";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../../convex/_generated/api";

/**
 * Settings → Payroll (P0.5b).
 *
 * Two cards, both admin-editable: the org's payroll conventions, and the statutory
 * tables the engine reads its numbers from (D17). The tables are national data —
 * not org-scoped — so a change here is a change for every org on the deployment.
 */
export default function PayrollSettingsPage() {
  const { orgId } = useActiveOrg();
  const me = useQuery(api.users.getMe, orgId ? { orgId } : {});
  const isAdmin = me?.membership?.role === "admin";

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>Payroll defaults</SectionTitle>
          <SectionDescription>
            The conventions a run uses when a position row does not state its own.
          </SectionDescription>
        </SectionHeader>
        {orgId ? (
          <FormPayrollSettings orgId={orgId} isAdmin={isAdmin} />
        ) : (
          <p className="text-muted-foreground text-sm">Select an organisation.</p>
        )}
      </Section>

      <Section>
        <SectionHeader>
          <SectionTitle>Statutory tables</SectionTitle>
          <SectionDescription>
            SSS, PhilHealth, Pag-IBIG, BIR withholding, the de minimis ceilings and
            the holiday calendar — versioned by effective date, each with its
            source. Enter a new schedule before it applies; the engine uses it from
            that date with no deploy.
          </SectionDescription>
        </SectionHeader>
        {orgId ? (
          <StatutoryTables orgId={orgId} isAdmin={isAdmin} />
        ) : (
          <p className="text-muted-foreground text-sm">Select an organisation.</p>
        )}
      </Section>
    </SectionGroup>
  );
}
