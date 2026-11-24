import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  addMemberToOrg,
  createTestConvex,
  seedOrgWithMember,
} from "./testUtils";

const PHILHEALTH_2026 = {
  rate: 0.05,
  employeeShare: 0.025,
  employerShare: 0.025,
  floor: 10000,
  ceiling: 100000,
};

describe("statutoryTables", () => {
  it("allows an admin to insert a statutory schedule and list it", async () => {
    const t = createTestConvex();
    const { orgId, asUser } = await seedOrgWithMember(t, { role: "admin" });

    const res = await asUser.mutation(api.payroll.statutoryTables.upsert, {
      orgId,
      kind: "philhealth",
      effectiveFrom: "2026-01-01",
      payload: PHILHEALTH_2026,
      source: "PhilHealth 2026 circular (RA 11223)",
    });
    expect(res.created).toBe(true);

    const rows = await asUser.query(api.payroll.statutoryTables.list, { orgId });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("philhealth");
  });

  it("refuses non-admin (hr) members from editing statutory tables", async () => {
    const t = createTestConvex();
    const { orgId } = await seedOrgWithMember(t, { role: "admin" });
    const hr = await addMemberToOrg(t, {
      orgId,
      role: "hr",
      email: "hr@example.com",
    });

    await expect(
      hr.asUser.mutation(api.payroll.statutoryTables.upsert, {
        orgId,
        kind: "philhealth",
        effectiveFrom: "2026-01-01",
        payload: PHILHEALTH_2026,
        source: "PhilHealth 2026 circular (RA 11223)",
      }),
    ).rejects.toThrow(/admin/i);
  });

  it("requires a source citation of at least 8 characters", async () => {
    const t = createTestConvex();
    const { orgId, asUser } = await seedOrgWithMember(t, { role: "admin" });

    await expect(
      asUser.mutation(api.payroll.statutoryTables.upsert, {
        orgId,
        kind: "philhealth",
        effectiveFrom: "2026-01-01",
        payload: PHILHEALTH_2026,
        source: "short",
      }),
    ).rejects.toThrow(/source citation/i);
  });

  // Unskip in Card 12 once statutoryTables.upsert closes open-ended predecessors before checking overlap.
  it.skip("TODO(Card 12): allows inserting a future schedule and closes the previous open-ended row", async () => {
    const t = createTestConvex();
    const { orgId, asUser } = await seedOrgWithMember(t, { role: "admin" });

    await asUser.mutation(api.payroll.statutoryTables.upsert, {
      orgId,
      kind: "philhealth",
      effectiveFrom: "2026-01-01",
      payload: PHILHEALTH_2026,
      source: "PhilHealth 2026 circular (RA 11223)",
    });

    await asUser.mutation(api.payroll.statutoryTables.upsert, {
      orgId,
      kind: "philhealth",
      effectiveFrom: "2027-01-01",
      payload: { ...PHILHEALTH_2026, ceiling: 120000 },
      source: "PhilHealth 2027 circular (RA 11223)",
    });

    const rows = await asUser.query(api.payroll.statutoryTables.list, { orgId });
    const ph = rows.filter((r) => r.kind === "philhealth");
    expect(ph).toHaveLength(2);
    expect(ph[0].effectiveTo).toBe(ph[1].effectiveFrom);
  });
});
