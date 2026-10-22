import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import bcrypt from "bcryptjs";
import type { DataModel } from "./_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";

const SALT_ROUNDS = 12;

/**
 * Password provider with bcryptjs-based hashing.
 * bcryptjs is pure-JS — no native binaries — so the Convex bundler handles it
 * without issues and the same algorithm is used for both self-registered users
 * and admin-created accounts.
 */
const passwordProvider = Password({
    crypto: {
        hashSecret: (password) => Promise.resolve(bcrypt.hashSync(password, SALT_ROUNDS)),
        verifySecret: (password, hash) => Promise.resolve(bcrypt.compareSync(password, hash)),
    },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
    providers: [passwordProvider],
    callbacks: {
        /**
         * Called on every sign-up (existingUserId is undefined) and on
         * subsequent sign-ins for existing accounts (existingUserId is set).
         *
         * For new sign-ups we conditionally create a default organization
         * unless an invitation token is provided — in that case the user will
         * call `acceptInvitation` as an authenticated user immediately after.
         */
        async createOrUpdateUser(ctx, args) {
            if (args.existingUserId) {
                // Existing user — nothing extra to do
                return args.existingUserId;
            }

            // Create the user record (authTables users schema)
            const userId = await ctx.db.insert("users", {
                email: args.profile.email ?? undefined,
                name:
                    args.profile.name ??
                    (args.profile.email
                        ? args.profile.email.split("@")[0]
                        : "New User"),
                emailVerificationTime: args.profile.emailVerified
                    ? Date.now()
                    : undefined,
            });

            // Only auto-create an org for standalone sign-ups, not for invited users.
            // A pending invitation for this email means the user is joining an existing org.
            // Scoped to this email via by_email — no table scan. `acceptedAt` is optional,
            // so filter in JS: Convex index ranges can't express "field is absent".
            // (by_email_org is unusable here — orgId is unknown at sign-up.)
            const email = args.profile.email;
            // The callback's ctx is typed against the generic (unparameterized)
            // data model, so index names collapse to `never` — narrow the db
            // handle to this repo's DataModel for the indexed read.
            const db = ctx.db as GenericDatabaseReader<DataModel>;
            const pendingInvitation = email
                ? ((await db
                    .query("invitations")
                    .withIndex("by_email", (q) => q.eq("email", email))
                    .collect()
                ).find((inv) => inv.acceptedAt === undefined && inv.expiresAt > Date.now()) ?? null)
                : null;

            const isInvited = Boolean(pendingInvitation);

            if (!isInvited) {
                const orgName =
                    (args.profile.name
                        ? `${args.profile.name}'s Company`
                        : args.profile.email
                            ? `${args.profile.email.split("@")[0]}'s Company`
                            : "My Company");

                const orgId = await ctx.db.insert("organizations", {
                    name: orgName,
                    createdBy: userId,
                });

                await ctx.db.insert("members", {
                    userId,
                    orgId,
                    role: "admin",
                });
            }

            return userId;
        },
    },
});
