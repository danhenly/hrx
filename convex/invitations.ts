import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireAuth } from "./helpers";
import { roleValidator } from "./schema";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Cryptographically random URL-safe token (server-side). */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Returns the invitation record for the given token (public — used on the
 * invite acceptance page before the user is authenticated).
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!invitation) return null;
    const org = await ctx.db.get(invitation.orgId);
    return { ...invitation, org };
  },
});

/**
 * List pending (not yet accepted, not expired) invitations for an org.
 * Accessible to admin users only.
 */
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const userId = await requireAuth(ctx);
    await requireAdmin(ctx, userId, orgId);
    const now = Date.now();
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.filter((i) => !i.acceptedAt && i.expiresAt > now);
  },
});

/**
 * Create an email invitation. Admin only.
 * Returns the invitation token so the caller can construct the invite URL.
 */
export const create = mutation({
  args: {
    email: v.string(),
    orgId: v.id("organizations"),
    role: roleValidator,
  },
  handler: async (ctx, { email, orgId, role }) => {
    const userId = await requireAuth(ctx);
    await requireAdmin(ctx, userId, orgId);

    // Prevent duplicate active invitations for the same email+org
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_email_org", (q) => q.eq("email", email).eq("orgId", orgId))
      .unique();
    if (existing && !existing.acceptedAt && existing.expiresAt > Date.now()) {
      throw new ConvexError("An active invitation already exists for this email");
    }

    const token = generateToken();
    const invitationId = await ctx.db.insert("invitations", {
      email,
      orgId,
      role,
      token,
      invitedBy: userId,
      expiresAt: Date.now() + INVITE_EXPIRY_MS,
    });

    return { invitationId, token };
  },
});

/**
 * The newly signed-up (invited) user calls this to link themselves to the org.
 * Must be called immediately after sign-up while the token is still valid.
 */
export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireAuth(ctx);

    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();

    if (!invitation) throw new ConvexError("Invalid invitation token");
    if (invitation.acceptedAt) throw new ConvexError("Invitation already used");
    if (invitation.expiresAt < Date.now()) throw new ConvexError("Invitation has expired");

    // Check the authenticated user's email matches the invitation
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");
    if (user.email !== invitation.email) {
      throw new ConvexError("This invitation is for a different email address");
    }

    // Avoid duplicate membership
    const existingMembership = await ctx.db
      .query("members")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", userId).eq("orgId", invitation.orgId)
      )
      .unique();

    if (!existingMembership) {
      await ctx.db.insert("members", {
        userId,
        orgId: invitation.orgId,
        role: invitation.role,
      });
    }

    // Mark invitation as accepted
    await ctx.db.patch(invitation._id, { acceptedAt: Date.now() });

    return { orgId: invitation.orgId };
  },
});

/**
 * Revoke a pending invitation. Admin only.
 */
export const revoke = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const userId = await requireAuth(ctx);
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new ConvexError("Invitation not found");
    await requireAdmin(ctx, userId, invitation.orgId);
    await ctx.db.delete(invitationId);
  },
});
