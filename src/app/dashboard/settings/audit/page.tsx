"use client";

import { format } from "date-fns";
import { useQuery } from "convex/react";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../../convex/_generated/api";

export default function AuditLogPage() {
  const { orgId, role } = useActiveOrg();
  const isAdmin = role === "admin";

  const rows = useQuery(api.audit.listForOrg, orgId ? { orgId } : "skip");

  if (!isAdmin) {
    return (
      <SectionGroup>
        <Section>
          <SectionHeader>
            <SectionTitle>Audit log</SectionTitle>
            <SectionDescription>
              Only administrators can view the audit log.
            </SectionDescription>
          </SectionHeader>
        </Section>
      </SectionGroup>
    );
  }

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>Audit log</SectionTitle>
          <SectionDescription>
            Append-only trail of membership and approval changes in this
            organization.
          </SectionDescription>
        </SectionHeader>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>Recent activity</FormCardTitle>
            <FormCardDescription>
              Newest first — written in the same transaction as the change it
              records.
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="pb-4">
            {rows === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No audit entries yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="whitespace-nowrap">
                        {format(row.at, "yyyy-MM-dd HH:mm")}
                      </TableCell>
                      <TableCell>{row.actorName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.action}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.entity.type}/{row.entity.id.slice(-6)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </FormCardContent>
        </FormCard>
      </Section>
    </SectionGroup>
  );
}
