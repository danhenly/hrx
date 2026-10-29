"use client";

import { useMutation, useQuery } from "convex/react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const days = (value: number) =>
  Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

/**
 * Leave balances (P8.1/P8.2).
 *
 * The balance is summed from the ledger the payroll runs wrote — never from an
 * entitlement table — so what an employee sees is what the register accrued.
 */
export function FormEmployeeLeave({
  employeeId,
  orgId,
}: {
  employeeId: Id<"employees">;
  orgId: Id<"organizations">;
}) {
  const rows = useQuery(api.payroll.leave.balances, { orgId, employeeId });
  const requests = useQuery(api.payroll.leave.listRequests, {
    orgId,
    employeeId,
    status: "pending",
  });
  const decide = useMutation(api.payroll.leave.decideLeave);
  const types = useQuery(api.payroll.leave.listTypes, { orgId });
  const seed = useMutation(api.payroll.leave.seedLeaveTypes);
  const [isPending, startTransition] = useTransition();

  const balances = rows?.[0]?.types ?? [];

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Balances accrue when a payroll run is computed, so they always agree
          with the register.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              try {
                const result = await seed({ orgId });
                toast.success(
                  `${result.created} leave type(s) added${result.refreshed ? `, ${result.refreshed} refreshed` : ""}`,
                );
              } catch (error) {
                toast.error(
                  (error as Error).message ?? "Could not seed leave types",
                );
              }
            })
          }
        >
          {types?.length ? "Refresh types" : "Seed leave types"}
        </Button>
      </div>

      {requests && requests.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-sm">Pending requests</p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request._id}>
                    <TableCell>{request.leaveCode}</TableCell>
                    <TableCell>
                      {new Date(request.startDate + 8 * 3_600_000)
                        .toISOString()
                        .slice(0, 10)}{" "}
                      →{" "}
                      {new Date(request.endDate + 8 * 3_600_000)
                        .toISOString()
                        .slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right">{request.days}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          startTransition(async () => {
                            try {
                              await decide({
                                orgId,
                                requestId: request._id,
                                approve: true,
                              });
                              toast.success(
                                "Approved — usage now hits the balance",
                              );
                            } catch (error) {
                              toast.error(
                                (error as Error).message ?? "Could not approve",
                              );
                            }
                          })
                        }
                      >
                        Approve
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {balances.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No leave accrued yet. Seed the leave types, then run payroll.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Accrued</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Adjusted</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((row) => (
                <TableRow key={row.code}>
                  <TableCell>
                    {row.name}
                    {row.convertibleOnSeparation && (
                      <span className="ml-2 text-muted-foreground text-xs">
                        convertible
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {days(row.accruedDays)}
                  </TableCell>
                  <TableCell className="text-right">
                    {days(row.usedDays)}
                  </TableCell>
                  <TableCell className="text-right">
                    {days(row.adjustedDays)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {days(row.balanceDays)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
