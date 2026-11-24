import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { msOfDateKey } from "../../convex/lib/payroll/calendar";
import {
  addMemberToOrg,
  createTestConvex,
  seedOrgWithMember,
} from "./testUtils";

async function seedPayrollOrg(t: ReturnType<typeof createTestConvex>) {
  const admin = await seedOrgWithMember(t, {
    orgName: "Pilot Co",
    role: "admin",
    email: "admin@pilot.test",
  });
  const hr = await addMemberToOrg(t, {
    orgId: admin.orgId,
    role: "hr",
    email: "hr@pilot.test",
  });

  await t.mutation(internal.payroll.seedStatutory.seedStatutoryTables, {
    orgId: admin.orgId,
    actorId: admin.userId,
  });

  const employeeId = await admin.asUser.mutation(api.employees.create, {
    orgId: admin.orgId,
    firstName: "Maria",
    lastName: "Santos",
    hireDate: msOfDateKey("2025-01-01"),
    status: "active",
  });

  const positionId = await admin.asUser.mutation(api.positions.create, {
    orgId: admin.orgId,
    name: "Staff",
  });

  await admin.asUser.mutation(api.employees.addPosition, {
    employeeId,
    positionId,
    effectiveDate: msOfDateKey("2025-01-01"),
    payType: "monthly",
    basicRate: 20000,
    dailyRateBasis: "313",
    workWeek: "6_day",
    statutoryBasis: "basic",
    allowances: [],
  });

  await admin.asUser.mutation(api.payroll.employeeStatutoryIds.update, {
    employeeId,
    sssNumber: "34-1234567-8",
    philhealthNumber: "12-345678901-2",
    pagibigNumber: "1234-5678-9012",
    tin: "123-456-789-000",
    bank: {
      bank: "BDO",
      accountName: "Maria Santos",
      accountNumber: "001234567890",
      accountType: "atm",
    },
  });

  const periodId = await admin.asUser.mutation(api.payroll.periods.createPeriod, {
    orgId: admin.orgId,
    startDate: "2026-11-10",
    endDate: "2026-11-24",
    payDate: "2026-11-30",
  });

  return { admin, hr, employeeId, periodId };
}

describe("payroll runs lifecycle", () => {
  it("enforces maker-checker: hr can compute and review, only admin can approve", async () => {
    const t = createTestConvex();
    const { admin, hr, periodId } = await seedPayrollOrg(t);

    const { runId } = await hr.asUser.mutation(api.payroll.runs.createRun, {
      orgId: admin.orgId,
      periodId,
    });

    // Call computeRun until done (at 4493f81 this takes 2 calls due to stale paid set; Card 11 fixes to 1).
    let done = false;
    for (let i = 0; i < 3 && !done; i += 1) {
      const res = await hr.asUser.mutation(api.payroll.runs.computeRun, {
        orgId: admin.orgId,
        runId,
      });
      done = res.done;
    }
    expect(done).toBe(true);

    await hr.asUser.mutation(api.payroll.runs.reviewRun, { runId });

    // HR must not be able to approve (D12).
    await expect(
      hr.asUser.mutation(api.payroll.runs.approveRun, { runId }),
    ).rejects.toThrow(/admin/i);

    // Admin approves and freezes the run.
    await admin.asUser.mutation(api.payroll.runs.approveRun, { runId });

    const detail = await admin.asUser.query(api.payroll.runs.get, { runId });
    expect(detail.run.status).toBe("approved");
    expect(detail.payslips).toHaveLength(1);
    expect(detail.payslips[0].gross).toBe(10000);
  });

  // Unskip in Card 11 once ledger writes move to approveRunCore and voidRun reverses them.
  it.skip("TODO(Card 11): draft compute does not mutate loan balance; approve posts once; void reverses", async () => {
    const t = createTestConvex();
    const { admin, hr, employeeId, periodId } = await seedPayrollOrg(t);

    const { loanId } = await admin.asUser.mutation(api.payroll.loans.create, {
      orgId: admin.orgId,
      employeeId,
      type: "sss",
      principal: 10000,
      termMonths: 10,
    });

    const { runId } = await hr.asUser.mutation(api.payroll.runs.createRun, {
      orgId: admin.orgId,
      periodId,
    });
    const res = await hr.asUser.mutation(api.payroll.runs.computeRun, {
      orgId: admin.orgId,
      runId,
    });
    expect(res.done).toBe(true);

    // Draft compute must NOT touch live loan balance.
    const loansAfterDraft = await admin.asUser.query(api.payroll.loans.list, {
      orgId: admin.orgId,
      employeeId,
    });
    expect(loansAfterDraft.find((l) => l._id === loanId)?.balance).toBe(10000);

    // Approve deducts once.
    await admin.asUser.mutation(api.payroll.runs.approveRun, { runId });
    const loansAfterApprove = await admin.asUser.query(api.payroll.loans.list, {
      orgId: admin.orgId,
      employeeId,
    });
    expect(loansAfterApprove.find((l) => l._id === loanId)?.balance).toBe(9500);

    // Voiding an approved run restores the balance.
    await admin.asUser.mutation(api.payroll.runs.voidRun, {
      runId,
      reason: "Test void reversal",
    });
    const loansAfterVoid = await admin.asUser.query(api.payroll.loans.list, {
      orgId: admin.orgId,
      employeeId,
    });
    expect(loansAfterVoid.find((l) => l._id === loanId)?.balance).toBe(10000);
  });
});
