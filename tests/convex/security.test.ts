import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createTestConvex, seedOrgWithMember } from "./testUtils";

describe("auth, tenant isolation & payslip links", () => {
  it("rejects unauthenticated access to org-scoped queries", async () => {
    const t = createTestConvex();
    const { orgId } = await seedOrgWithMember(t, { role: "admin" });

    await expect(
      t.query(api.employees.list, { orgId }),
    ).rejects.toThrow(/not authenticated/i);
  });

  it("blocks Org B from reading Org A's employees or payroll periods", async () => {
    const t = createTestConvex();
    const orgA = await seedOrgWithMember(t, {
      orgName: "Org A",
      role: "admin",
      email: "a@orga.test",
    });
    const orgB = await seedOrgWithMember(t, {
      orgName: "Org B",
      role: "admin",
      email: "b@orgb.test",
    });

    await expect(
      orgB.asUser.query(api.employees.list, { orgId: orgA.orgId }),
    ).rejects.toThrow(/access denied/i);

    await expect(
      orgB.asUser.query(api.payroll.periods.list, { orgId: orgA.orgId }),
    ).rejects.toThrow(/access denied/i);
  });

  it("resolves a minted payslip link only to its own payslip and stops working when revoked", async () => {
    const t = createTestConvex();
    const { orgId, asUser } = await seedOrgWithMember(t, { role: "admin" });

    const { payslipA, payslipB } = await t.run(async (ctx) => {
      const empA = await ctx.db.insert("employees", {
        orgId,
        firstName: "Ana",
        lastName: "Reyes",
        hireDate: 0,
        status: "active",
      });
      const empB = await ctx.db.insert("employees", {
        orgId,
        firstName: "Ben",
        lastName: "Cruz",
        hireDate: 0,
        status: "active",
      });
      const period = await ctx.db.insert("payrollPeriods", {
        orgId,
        periodType: "semi_monthly",
        startDate: 1000,
        endDate: 2000,
        payDate: 3000,
        status: "open",
      });
      const run = await ctx.db.insert("payrollRuns", {
        orgId,
        periodId: period,
        version: 1,
        status: "approved",
        totals: {
          gross: 2000,
          deductions: 0,
          net: 2000,
          employerCost: 0,
          employeeCount: 2,
        },
        blocked: [],
      });
      const payslipA = await ctx.db.insert("payslips", {
        orgId,
        runId: run,
        employeeId: empA,
        gross: 1000,
        totalDeductions: 0,
        net: 1000,
        employerCost: 0,
        daysWorked: 10,
        minutesWorked: 4800,
      });
      const payslipB = await ctx.db.insert("payslips", {
        orgId,
        runId: run,
        employeeId: empB,
        gross: 1000,
        totalDeductions: 0,
        net: 1000,
        employerCost: 0,
        daysWorked: 10,
        minutesWorked: 4800,
      });
      return { payslipA, payslipB };
    });

    const minted = await asUser.mutation(api.payroll.payslipLinks.mint, {
      orgId,
      payslipId: payslipA,
    });

    const resolved = await t.query(api.payroll.payslipLinks.getByToken, {
      token: minted.token,
    });
    expect(resolved.status).toBe("ok");
    if (resolved.status === "ok") {
      expect(resolved.payslip._id).toBe(payslipA);
      expect(resolved.payslip._id).not.toBe(payslipB);
      expect(resolved.employee.name).toBe("Ana Reyes");
    }

    await asUser.mutation(api.payroll.payslipLinks.revoke, {
      orgId,
      linkId: minted.linkId,
    });
    const afterRevoke = await t.query(api.payroll.payslipLinks.getByToken, {
      token: minted.token,
    });
    expect(afterRevoke.status).toBe("invalid");
  });

  // Unskip in Card 13 once payslipLinks.listForPayslip verifies payslip.orgId === orgId.
  it.skip("TODO(Card 13): refuses Org B listing Org A's payslipLinks by payslipId", async () => {
    const t = createTestConvex();
    const orgA = await seedOrgWithMember(t, {
      orgName: "Org A",
      role: "admin",
      email: "a@orga.test",
    });
    const orgB = await seedOrgWithMember(t, {
      orgName: "Org B",
      role: "admin",
      email: "b@orgb.test",
    });

    const payslipId = await t.run(async (ctx) => {
      const emp = await ctx.db.insert("employees", {
        orgId: orgA.orgId,
        firstName: "Ana",
        lastName: "Reyes",
        hireDate: 0,
        status: "active",
      });
      const period = await ctx.db.insert("payrollPeriods", {
        orgId: orgA.orgId,
        periodType: "semi_monthly",
        startDate: 1000,
        endDate: 2000,
        payDate: 3000,
        status: "open",
      });
      const run = await ctx.db.insert("payrollRuns", {
        orgId: orgA.orgId,
        periodId: period,
        version: 1,
        status: "approved",
        totals: {
          gross: 1000,
          deductions: 0,
          net: 1000,
          employerCost: 0,
          employeeCount: 1,
        },
        blocked: [],
      });
      return ctx.db.insert("payslips", {
        orgId: orgA.orgId,
        runId: run,
        employeeId: emp,
        gross: 1000,
        totalDeductions: 0,
        net: 1000,
        employerCost: 0,
        daysWorked: 10,
        minutesWorked: 4800,
      });
    });

    await orgA.asUser.mutation(api.payroll.payslipLinks.mint, {
      orgId: orgA.orgId,
      payslipId,
    });

    await expect(
      orgB.asUser.query(api.payroll.payslipLinks.listForPayslip, {
        orgId: orgB.orgId,
        payslipId,
      }),
    ).rejects.toThrow(/not found/i);
  });

  // Unskip in Card 13 once loans.history verifies loan.orgId === orgId.
  it.skip("TODO(Card 13): refuses Org B reading Org A's loan amortisation history", async () => {
    const t = createTestConvex();
    const orgA = await seedOrgWithMember(t, {
      orgName: "Org A",
      role: "admin",
      email: "a@orga.test",
    });
    const orgB = await seedOrgWithMember(t, {
      orgName: "Org B",
      role: "admin",
      email: "b@orgb.test",
    });

    const employeeId = await orgA.asUser.mutation(api.employees.create, {
      orgId: orgA.orgId,
      firstName: "Ana",
      lastName: "Reyes",
      hireDate: 0,
      status: "active",
    });
    const { loanId } = await orgA.asUser.mutation(api.payroll.loans.create, {
      orgId: orgA.orgId,
      employeeId,
      type: "sss",
      principal: 10000,
      termMonths: 10,
    });

    await expect(
      orgB.asUser.query(api.payroll.loans.history, {
        orgId: orgB.orgId,
        loanId,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
