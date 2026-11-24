import { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

declare global {
  interface ImportMeta {
    glob: (
      pattern: string | string[],
    ) => Record<string, () => Promise<unknown>>;
  }
}

// Load deployable Convex functions + _generated runtime files into the in-memory simulator.
// Tests live outside convex/ so `npx convex dev` / `deploy` never bundles test code.
export const modules = import.meta.glob([
  "/convex/**/*.ts",
  "/convex/**/*.js",
  "!/convex/**/*.d.ts",
]);

export function createTestConvex() {
  return convexTest(schema, modules);
}

/**
 * Seed a user + organisation + membership and return an authenticated test client.
 * `@convex-dev/auth` parses `identity.subject` as `<userId>|<sessionId>`.
 */
export async function seedOrgWithMember(
  t: ReturnType<typeof createTestConvex>,
  opts: { orgName?: string; role: "admin" | "hr"; email?: string },
) {
  const { userId, orgId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: opts.role.toUpperCase(),
      email: opts.email ?? `${opts.role}@example.com`,
    });
    const orgId = await ctx.db.insert("organizations", {
      name: opts.orgName ?? "Test Org",
      createdBy: userId,
    });
    await ctx.db.insert("members", { userId, orgId, role: opts.role });
    return { userId, orgId };
  });

  const asUser = t.withIdentity({ subject: `${userId}|test-session` });
  return { userId, orgId, asUser };
}

/** Add another member (e.g. an HR preparer or second admin) to an existing org. */
export async function addMemberToOrg(
  t: ReturnType<typeof createTestConvex>,
  opts: {
    orgId: Id<"organizations">;
    role: "admin" | "hr";
    email: string;
  },
) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      name: opts.role.toUpperCase(),
      email: opts.email,
    });
    await ctx.db.insert("members", {
      userId: id,
      orgId: opts.orgId,
      role: opts.role,
    });
    return id;
  });

  const asUser = t.withIdentity({ subject: `${userId}|test-session` });
  return { userId, asUser };
}
