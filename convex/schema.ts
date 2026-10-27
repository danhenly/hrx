import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// role enum shared across members & invitations
export const roleValidator = v.union(v.literal("admin"), v.literal("hr"));

export default defineSchema({
    // Convex Auth tables: users, authAccounts, authSessions,
    // authRefreshTokens, authVerificationCodes, authRateLimits
    ...authTables,

    /**
     * Organizations — the top-level tenant.
     * Every piece of HR data will carry an orgId reference.
     */
    organizations: defineTable({
        name: v.string(),
        address: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        createdBy: v.id("users"),
    }),

    /**
     * Members — join table linking a user to an organization with a role.
     * This is the source-of-truth for tenant isolation checks.
     */
    members: defineTable({
        userId: v.id("users"),
        orgId: v.id("organizations"),
        role: roleValidator,
    })
        .index("by_user", ["userId"])
        .index("by_org", ["orgId"])
        .index("by_user_org", ["userId", "orgId"]),

    /**
     * Invitations — pending email invitations to join an org.
     * token is a cryptographically random URL-safe string.
     */
    invitations: defineTable({
        email: v.string(),
        orgId: v.id("organizations"),
        role: roleValidator,
        token: v.string(),
        invitedBy: v.id("users"),
        expiresAt: v.number(), // Unix ms
        acceptedAt: v.optional(v.number()),
    })
        .index("by_token", ["token"])
        .index("by_org", ["orgId"])
        .index("by_email", ["email"])
        .index("by_email_org", ["email", "orgId"]),

    // ─── HR: Employee Management ───────────────────────────────────────────

    /**
     * Employees — workforce records managed within the tenant.
     * Deliberately separate from `users` (who log in to the app).
     */
    employees: defineTable({
        orgId: v.id("organizations"),
        firstName: v.string(),
        lastName: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        dateOfBirth: v.optional(v.number()),   // Unix ms
        hireDate: v.number(),                  // Unix ms
        status: v.union(
            v.literal("active"),
            v.literal("terminated"),
            v.literal("on_leave"),
        ),
    })
        .index("by_org", ["orgId"])
        .index("by_org_status", ["orgId", "status"]),

    /**
     * Employee Positions — immutable history of titles, departments & salaries.
     * The "current" position is the row with no endDate (or the most-recent one).
     */
    employeePositions: defineTable({
        orgId: v.id("organizations"),        // denormalised for easier scoping queries
        employeeId: v.id("employees"),
        jobTitle: v.string(),
        department: v.optional(v.string()),
        salary: v.optional(v.number()),      // gross annual, base currency units
        effectiveDate: v.number(),           // Unix ms — when this position started
        endDate: v.optional(v.number()),     // Unix ms — null / absent = still current
        notes: v.optional(v.string()),
        positionId: v.optional(v.id("positions")),   // absent on pre-masterlist rows
    })
        .index("by_employee", ["employeeId"])
        .index("by_org", ["orgId"])
        .index("by_employee_effective", ["employeeId", "effectiveDate"])
        .index("by_org_position", ["orgId", "positionId"]),    // NEW — delete guard

    /**
     * Positions — the org's masterlist of job titles.
     * Deactivation is the retirement path: history keeps referring to a position
     * that is no longer offered. Deletion is blocked while any history row uses it.
     */
    positions: defineTable({
        orgId: v.id("organizations"),
        name: v.string(),
        nameKey: v.string(),        // name.trim().toLowerCase() — case-insensitive uniqueness
        department: v.optional(v.string()),
        description: v.optional(v.string()),
        isActive: v.boolean(),
        createdBy: v.id("users"),
        createdAt: v.number(),
        updatedBy: v.id("users"),
        updatedAt: v.number(),
    })
        .index("by_org", ["orgId"])
        .index("by_org_active", ["orgId", "isActive"])
        .index("by_org_name_key", ["orgId", "nameKey"]),

    // ─── Timekeeping ────────────────────────────────────────────────────────

    /**
     * Timesheets — weekly submission per employee.
     */
    timesheets: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        weekStart: v.number(), // Unix ms start-of-week
        status: v.union(
            v.literal("open"),
            v.literal("submitted"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("locked"),
        ),
        submittedAt: v.optional(v.number()),
        approvedAt: v.optional(v.number()),
        approvedBy: v.optional(v.id("users")),
        rejectedReason: v.optional(v.string()),
        totalMinutes: v.optional(v.number()),
        lockedAt: v.optional(v.number()),           // when the week became immutable
        lockedBy: v.optional(v.id("users")),        // who locked it
    })
        .index("by_org", ["orgId"])
        .index("by_org_employee", ["orgId", "employeeId"])
        .index("by_org_week", ["orgId", "weekStart"])
        .index("by_org_employee_week", ["orgId", "employeeId", "weekStart"]),

    /**
     * Time entries — per employee per day with up to 3 intervals.
     */
    timeEntries: defineTable({
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        date: v.number(), // Unix ms (start-of-day)
        intervals: v.array(
            v.object({
                start: v.number(), // Unix ms
                end: v.number(),   // Unix ms (can cross midnight, counted on start date)
                durationMinutes: v.number(),
            }),
        ),
        totalMinutes: v.number(),
        notes: v.optional(v.string()),
        source: v.literal("manual"),
        status: v.union(
            v.literal("draft"),
            v.literal("submitted"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("locked"), // frozen for payroll; replaces the week sheet's state
        ),
        rejectedReason: v.optional(v.string()),
        timesheetId: v.optional(v.id("timesheets")), // legacy; no longer written
        submittedAt: v.optional(v.number()),
        approvedAt: v.optional(v.number()),
        approvedBy: v.optional(v.id("users")),
        lockedAt: v.optional(v.number()),
        lockedBy: v.optional(v.id("users")),
        createdBy: v.id("users"),
        updatedBy: v.id("users"),
    })
        .index("by_org", ["orgId"])
        .index("by_org_employee_date", ["orgId", "employeeId", "date"])
        .index("by_org_date", ["orgId", "date"])
        .index("by_timesheet", ["timesheetId"]),     // optional field, drafts excluded

    // ─── Audit ──────────────────────────────────────────────────────────────

    /**
     * Audit logs — append-only trail of who did what, when, in which org.
     * Written inside the mutation that performs the change (same
     * transaction), never from an action. No update/delete functions are
     * exported.
     */
    auditLogs: defineTable({
        orgId: v.id("organizations"),
        actorId: v.id("users"),
        action: v.string(), // e.g. "employee.create", "timesheet.approve"
        entity: v.object({ type: v.string(), id: v.string() }),
        at: v.number(), // Unix ms
    })
        .index("by_org_at", ["orgId", "at"])
        .index("by_org_entity", ["orgId", "entity.type", "entity.id"]),
});
