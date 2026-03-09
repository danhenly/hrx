# HRX — Agent Instructions

This document is the canonical guide for any AI agent working in this repository.
Read it fully before making any changes.

---

## Project Overview

**HRX** is a Human Resources Information System (HRIS) for small and medium-sized businesses.
It is built on the [openstatus template](https://github.com/openstatusHQ/openstatus-template) and extends it with a full multi-tenant HR backend.

### Core architecture

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Database & backend | Convex DB |
| Auth | Convex Auth (`@convex-dev/auth`) — Password provider with `bcryptjs` |
| UI components | shadcn/ui (New York style) + Tailwind CSS v4 |
| Form validation | React Hook Form + Zod |
| Linter / formatter | Biome (not ESLint for lint, not Prettier) |
| Package manager | **pnpm** — never use `npm` or `yarn` |

---

## Repository Layout

```
convex/               ← ALL backend logic lives here (Convex functions)
  schema.ts           ← Single source of truth for all table definitions
  auth.ts             ← Convex Auth config (providers, createOrUpdateUser hook)
  http.ts             ← Convex HTTP router (mounts auth routes)
  helpers.ts          ← Shared auth/RBAC guard utilities
  organizations.ts    ← Org queries & mutations
  users.ts            ← User queries, member management, internal helpers
  invitations.ts      ← Invitation create / accept / revoke flow
  actions.ts          ← Node-capable actions (e.g., bcrypt password hashing)
  _generated/         ← AUTO-GENERATED — never edit manually

src/
  app/
    (auth)/           ← Public auth pages: sign-in, sign-up, invite/[token]
    dashboard/        ← Protected HRIS app shell (sidebar + settings)
    layout.tsx        ← Root layout — wraps everything in Convex providers
  components/
    forms/
      auth/           ← FormSignIn, FormSignUp
      settings/       ← FormOrganization, FormTeam (Convex-wired)
      form-card.tsx   ← Base card shell for all settings forms
    nav/
      nav-user.tsx    ← Live user avatar/menu — reads from api.users.getMe
      app-sidebar.tsx ← Main sidebar
    ui/               ← shadcn/ui primitives — do not modify directly
  providers/
    convex-provider.tsx ← ConvexClientProvider (client wrapper)
  middleware.ts       ← Route protection via convexAuthNextjsMiddleware
```

---

## Multi-Tenancy & Security Model

**This is the most critical section. All data access MUST follow these rules.**

Every user belongs to exactly one organisation via the `members` join table.
All queries and mutations enforce access at the function level — never rely on the UI to restrict data.

### Mandatory guards (defined in `convex/helpers.ts`)

```ts
// 1. Verify the caller is authenticated
const userId = await requireAuth(ctx);

// 2. Verify membership in the target org
const membership = await requireMembership(ctx, userId, orgId);

// 3. For write operations, also verify admin role
await requireAdmin(ctx, userId, orgId);
```

**Rules:**
- Every public query or mutation that returns org-scoped data MUST call at least `requireAuth` + `requireMembership`.
- Admin-only mutations (create/delete/invite) MUST also call `requireAdmin`.
- Never return data from another org. Always scope DB queries with `orgId` filters.
- `_generated/` types provide full type-safety — use them; don't cast to `any`.

---

## Convex Development Workflow

### Schema changes

1. Edit `convex/schema.ts`.
2. Run `npx convex dev --once` to push the schema and regenerate `_generated/` types.
3. If there is a chicken-and-egg type error on the first push, use `--typecheck=disable` once, then re-run normally.

```powershell
# Normal push + type regeneration
npx convex dev --once

# Bootstrap when generated types are stale
npx convex dev --once --typecheck=disable
npx convex dev --once   # second run validates cleanly
```

### Adding a new Convex function

- **Queries** (`query`) — read-only, cached, callable from client and server.
- **Mutations** (`mutation`) — transactional writes, callable from client.
- **Actions** (`action`) — can call external APIs or use async Node modules (e.g., bcrypt). Place in `convex/actions.ts`.
- **Internal** (`internalQuery` / `internalMutation`) — server-to-server only; prefix export name with `_` by convention.

Always import types from `./_generated/dataModel` and `./_generated/server`:

```ts
import type { Id } from "./_generated/dataModel";
import { query, mutation } from "./_generated/server";
```

### Password hashing

Use **`bcryptjs`** (pure JS, no native binaries). The same library is configured in both:
- `convex/auth.ts` — Password provider `crypto` adapter
- `convex/actions.ts` — `createDirectUser` action

Do **not** use `@node-rs/argon2` or any other native module. The Convex bundler cannot handle `.node` binary files.

---

## Next.js Conventions

### Route groups

| Group | Protection | Purpose |
|---|---|---|
| `(auth)` | Public | Sign-in, sign-up, invite |
| `dashboard/` | Protected (middleware) | Main HRIS app |
| `landing/` | Public | Marketing pages |
| `status-page/` | Public | Public status pages |

### Server vs client components

- Pages under `dashboard/` that only render layout are **Server Components** by default.
- Any component that calls `useQuery`, `useMutation`, `useAction`, or `useAuthActions` must be a **Client Component** (`"use client"` at the top).
- Server components can use `fetchQuery` from `convex/nextjs` for SSR data.
- The root `layout.tsx` uses `ConvexAuthNextjsServerProvider` (server) wrapping `ConvexClientProvider` (client).

### Path aliases

```ts
import { ... } from "@/components/..."   // src/components
import { ... } from "@/lib/..."          // src/lib
import { api } from "../../convex/_generated/api"; // relative from file location
```

The `api` object must be imported with a **relative path** from the file — not via `@/`. This is because it lives in `convex/`, not `src/`.

### middleware.ts

Located at `src/middleware.ts`. Protected routes redirect to `/sign-in`. Authenticated users on `/sign-in` or `/sign-up` redirect to `/dashboard`. To add a new public route, add it to the `isPublicRoute` matcher array.

---

## UI Component Conventions

### shadcn/ui

- Style: **New York**
- Base color: **neutral**
- CSS variables: enabled
- Icon library: **lucide-react**
- Add new components via: `pnpm dlx shadcn@latest add <component>`
- Do **not** modify files under `src/components/ui/` manually; they are managed by shadcn.

### Form pattern

All settings forms follow this structure:

```tsx
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormCard>
      <FormCardHeader>
        <FormCardTitle>...</FormCardTitle>
        <FormCardDescription>...</FormCardDescription>
      </FormCardHeader>
      <FormCardContent>
        {/* FormField items */}
      </FormCardContent>
      <FormCardFooter>
        <Button type="submit" disabled={isPending}>...</Button>
      </FormCardFooter>
    </FormCard>
  </form>
</Form>
```

Use `useTransition` for pending state — do not use `useState(false)` for loading flags.

### Data table pattern

Tables under `src/components/data-table/` receive typed `data` props.
For Convex-backed tables, fetch with `useQuery` in the parent form/page and pass the result down.

---

## Linting & Formatting

This project uses **Biome**, not ESLint for linting or Prettier for formatting.

```powershell
pnpm lint          # biome lint
pnpm format        # biome format + check
pnpm lint:fix      # biome lint --write
pnpm format:fix    # biome check --fix
```

**Biome rules to be aware of:**
- `noUnusedImports` is an **error** — always remove unused imports before committing.
- `noUnusedVariables` is a **warning**.
- `noArrayIndexKey` is **off** — using array index as React key is allowed.

---

## RBAC Reference

| Role | Capabilities |
|---|---|
| `admin` | Full access: update org, invite users, create users directly, remove members, change roles |
| `hr` | Read access to org data; cannot modify members or org settings |

Role is stored on the `members` table, not on the `users` table. Always check the membership row for role — not the user document.

---

## Environment Variables

| Variable | Location | Purpose |
|---|---|---|
| `CONVEX_DEPLOYMENT` | `.env.local` | Convex project identifier |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | Convex cloud URL for client |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `.env.local` | Convex site URL for HTTP actions |
| `CONVEX_AUTH_PRIVATE_KEY` | Convex dashboard env vars | JWT signing key for Convex Auth |
| `CONVEX_AUTH_ADAPTER_SECRET` | Convex dashboard env vars | Cookie encryption key (set automatically by `convex dev`) |

Never commit secrets. `.env.local` is gitignored.

---

## Common Commands

```powershell
pnpm dev                     # Next.js (Turbopack) + Convex dev server
npx convex dev               # Convex dev watcher only
npx convex dev --once        # One-shot push + type regeneration
pnpm build                   # Next.js build + shadcn registry build
pnpm tsc                     # TypeScript check (no emit)
pnpm lint                    # Biome lint
pnpm format:fix              # Biome auto-fix
```

---

## Key Anti-Patterns to Avoid

- ❌ Calling `useMutation` inside a click handler callback body (hooks must be at component top level)
- ❌ Using `npm` or `yarn` — always use `pnpm`
- ❌ Editing `convex/_generated/` files — they are overwritten on every `convex dev` run
- ❌ Using `@node-rs/argon2` or any native `.node` binary in Convex functions
- ❌ Using `useState` for async loading state — prefer `useTransition`
- ❌ Returning org data without first calling `requireMembership` or `requireAdmin`
- ❌ Adding `output: "export"` limitations — note `next.config.ts` currently has `output: "export"` which disables many server features; if adding server-side features (API routes, server actions), remove this option
- ❌ Importing `api` via `@/` alias — it must be a relative import from `convex/_generated/api`

---

## Adding New HR Modules (Checklist)

When adding a new data domain (e.g., employees, payroll, leave requests):

1. **Schema**: Add table to `convex/schema.ts` with `orgId: v.id("organizations")` field.
2. **Convex functions**: Create `convex/<module>.ts` with at minimum:
   - A `list` query — scoped by `orgId`, guarded by `requireMembership`
   - A `create` mutation — guarded by `requireAdmin` or `requireMembership` as appropriate
   - A `remove` mutation — guarded by `requireAdmin`
3. **Push**: Run `npx convex dev --once` to regenerate types.
4. **UI**: Create `src/components/forms/<module>/` following the `FormCard` pattern.
5. **Route**: Add page under `src/app/dashboard/<module>/`.
6. **Navigation**: Add entry to `data.overview` in `src/components/nav/app-sidebar.tsx`.
