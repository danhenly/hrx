# HRX — React composition audit

**Skill:** `vercel-composition-patterns` v1.0.0 (Vercel Engineering, MIT) — 8 rules, 4 categories
**Commit:** `e0af7b7` · **Stack:** Next.js 16.1.6, React 19.2.3, Convex, shadcn/ui, Biome
**Scope:** all `src/` components and pages, read-only review
**Not run:** typecheck/build — CI owns those (`tsc`, `lint`, fixtures, `next build`). No source changed by this audit.

---

## C1. `ReasonDialog` encodes three variants in two booleans (HIGH)

> **Status: FIXED** — `ReasonDialogFrame` + `ConfirmDialogFrame` behind `RejectDaysDialog` / `UnlockDaysDialog` / `DeleteEntryDialog`; the page renders one by `kind` and no boolean reaches the API.
**Rules:** `architecture-avoid-boolean-props`, `patterns-explicit-variants`

- `src/components/forms/timekeeping/reason-dialog.tsx:15-26` — props include `requireReason` and `destructive`; the body branches on both (`:66`, `:81`, `:84`).
- `src/app/dashboard/time/page.tsx:364-390` — the caller builds a config object per kind (`unlock`, `delete`, `reject`), setting both booleans and four copy strings.

So a single component owns three modal flows, and the knowledge of which combination is valid lives in a ternary in the page. Adding a fourth action means another branch in both places, and `destructive: true, requireReason: true` is currently representable but meaningless.

**Fix:** a shared `ReasonDialogFrame` (content + reason field + footer slot) with three explicit wrappers — `RejectDaysDialog`, `UnlockDaysDialog`, `DeleteEntryDialog` — each owning its copy, booleans and defaults. The page renders one by `kind` instead of assembling config.

## C2. `isAdmin` is prop-drilled while the provider already knows the role (MEDIUM)

> **Status: FIXED** — `useIsAdmin()` reads the org context; the prop is gone from 10 components, 4 pages dropped their `users.getMe` role query, and the positions page keeps a local variable only for its own guard.
**Rule:** `state-lift-state`

- `OrgProvider` already exposes `role` (`src/providers/org-provider.tsx:29`), and `settings/audit/page.tsx:33` reads it correctly.
- Five other pages instead re-derive it from a separate `users.getMe` query (`employees/page.tsx:27`, `time/page.tsx:105`, `settings/payroll/page.tsx:26`, `settings/positions/page.tsx:39`) and thread it through props into nine components (`form-payroll-settings`, `departments-card`, `employee-sheet`, both data tables, `form-team`, `form-organization`, `statutory-tables`, `payroll-register`).

Two sources of truth for the same fact, an extra query on four pages, and a prop every intermediate component must remember to forward.

**Fix:** expose `useIsAdmin()` (or read `role` from `useActiveOrg()`) where the permission is consumed and delete the prop. Keep the page-level variable only where the page itself gates UI.

## C3. `OrgContext` is a flat bag, not the state/actions interface (LOW-MEDIUM)

> **Status: DEFERRED** — optional interface split; the value is already memoised.
**Rules:** `state-context-interface`, `react19-no-forwardref` (the `use()` point)

- `src/providers/org-provider.tsx:24-31` — `{ orgs, active, orgId, role, setActiveOrg }` mixes state, derived values and the action in one object.

It is already memoised (fixed in the earlier pass), so this is not a re-render bug. The cost is interface shape: any consumer that only dispatches (`setActiveOrg`) still subscribes to the whole value, and there is no `meta` slot for things like `role`.

**Fix (optional):** split into `useOrgState()` / `useOrgActions()`, and switch `useContext` to React 19's `use()` (`:70`). Only worth it if the provider grows.

## C4. `renderActions` — reviewed, correctly used (no action)

`src/components/data-table/timesheets/data-table.tsx:30` + `columns.tsx:13,89`.

Rule 3.2 prefers children over `renderX` props, but it carves out the case where the parent supplies data to the child — here the column hands each row to the renderer (`renderActions?.(row.original)`). That is the intended use; replacing it with children would require the table to know the page's action set. Leave it.

## C5. `FormCard` carries a stale composition TODO and a dead variant (LOW)

> **Status: FIXED** — dead `variant` plumbing and the stale provider TODO removed from `form-card.tsx`.
- `src/components/forms/form-card.tsx:29` — `// NOTE: Add a formcardprovider to share the variant prop`.
- No caller passes `variant` to `FormCard` or `FormCardFooter` (0 occurrences), and `FormCardHeader`/`FormCardTitle`/`FormCardContent` never read it.

The provider the note asks for would have nothing to share. **Fix:** delete the note and the unused `variant` plumbing on `FormCard`/`FormCardFooter`, or implement the provider when a real destructive-card pairing appears.

---

## Already healthy against these rules

- **Explicit variants exist**: `AddEmployeeSheet` and `EditEmployeeSheet` are separate exports (`employee-sheet.tsx:35,194`), not one component with an `isEdit` boolean.
- **Compound families are children-based**: `Module*` (`layout/module.tsx`), `Section*` (`content/section.tsx`), `FormCard*` — all take `children` and spread native props; `SectionGroup` uses a `width` union rather than booleans.
- **React 19 ready**: zero `forwardRef` in `src/`; refs are plain props.
- **No components defined inside components**, so no remount-by-identity bugs.
- **One dialog component instead of three near-duplicate modals** is the right instinct; C1 is about the API shape, not the consolidation.

## Suggested order

1. **C2** — largest surface, mechanical change, removes an extra query per page.
2. **C1** — small file, makes the three flows self-documenting.
3. **C5** — delete dead code.
4. **C3** — only if the provider gains more consumers.
