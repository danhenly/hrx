# HRX — React/Next.js performance audit

**Skill:** `vercel-react-best-practices` v1.0.0 (Vercel Engineering, MIT) — 70 rules, 8 categories
**Commit:** `5c2ea7d` · **Stack:** Next.js 16.1.6 (App Router, Turbopack), React 19.2.3, Convex, Tailwind v4, Biome
**Scope:** 131 `.ts/.tsx` files (26,775 lines incl. `convex/`), read-only static review
**Fixes applied:** F1, F2, F3, F4, F6, F8, F11, F12, F13 (see status lines below). `tsc`, `biome lint` and `next build` run in CI (`.github/workflows/ci.yml`).
**Not run:** `pnpm lint`, `pnpm tsc`, production build — host has 1.6 GB RAM and builds freeze it; CI owns those gates.

---

## High impact

### F1. Unstable `renderActions` prop defeats the column memo (rerender-memo, rerender-dependencies)
- `src/app/dashboard/time/page.tsx:227` — `function renderActions(entry) {...}` is recreated on every render.
- `src/components/data-table/timesheets/data-table.tsx:48` — `useMemo(() => timesheetColumns(employeesById, renderActions), [employeesById, renderActions])`.

> **Status: FIXED** — `runBatch` and `renderActions` are `useCallback`-stable; deps limited to real inputs.
Every TimePage render (filter change, row-selection checkbox, date input keystroke) produces a new function identity, so the memo never hits, all column defs are rebuilt, and TanStack rebuilds its row model. Row selection alone triggers this on every click.
**Fix:** wrap in `useCallback([])` with refs for changing values, or move the action cell into a component that subscribes to the row itself.

### F2. Manual entry grid re-renders every row on every keystroke (rerender-memo, rerender-derived-state-no-effect)
- `src/components/forms/timekeeping/manual-entry-grid.tsx:58` — a single `rows` state array for the whole week.
- `:212` — `rows.map((row) => <tr>...)` inline; no per-row component.
- `:65-90` — `useEffect([entries])` maps every entry and calls `setRows(...)` (second render per server update; also clobbers in-flight edits when a query refresh lands).

> **Status: FIXED** — rows are a memoised `EntryRow`; edits touch one row's object identity, so the rest do not re-render.
Each cell edit (`updateRow`) replaces the array, so a 20-row × 3-interval week re-renders 20 rows and rebuilds every `<Select>` element tree while typing.
**Fix:** extract a memoized `<EntryRow>` that owns its cell state, keep only a draft map at the parent, and derive server rows instead of copying them into state.

### F3. Context value is a new object every provider render (rerender-split-combined-hooks)
- `src/providers/org-provider.tsx:54-63` — `<OrgContext.Provider value={{ orgs, active, orgId, role, setActiveOrg }}>` where `setActiveOrg` is also recreated (`:49`).

> **Status: FIXED** — context value memoized, setter wrapped in `useCallback`.
Any `OrgProvider` render — including every `organizations.listMyOrgs` update — re-renders every `useActiveOrg()` consumer (dashboard layout, sidebar, every page).
**Fix:** `useMemo` the value and `useCallback` the setter, or split the static context from the setter context.

---

## Medium impact

### F4. Server data copied into five `useState`s via an effect (rerender-derived-state-no-effect)
- `src/components/forms/payroll/form-payroll-settings.tsx:44-57`

> **Status: FIXED** — the form mounts only after data loads and seeds `useState` once; no sync effect, no clobbering.
Default values are re-applied whenever `data` changes, so a settings refetch silently discards unsaved edits, and the first paint shows defaults before the effect lands.
**Fix:** initialise once (`useState(() => data.settings...)` guarded by a loaded skeleton + `key`), or drive the form with defaults from a keyed child.

### F5. The dashboard shell is a client component (server-serialization, async-suspense-boundaries)
- `src/app/dashboard/layout.tsx:1` — `"use client"`; 15 of 23 `page.tsx` files are client too.

> **Status: DEFERRED** — architectural; only worth it if route latency becomes a reported problem.
Consequence: every dashboard route ships its JS first, then starts Convex queries after hydration — a JS → query waterfall instead of server-rendered data. This is a deliberate fit for the Convex client-query model, but it is the single biggest remaining latency lever: the shell (`OrgProvider`, `SidebarProvider`, `AppSidebar`) could stay server-rendered with only the interactive islands as client components.
**Fix:** defer unless route latency is a real complaint; it is an architecture change, not a patch.

### F6. Index keys on a mutable interval list (rendering/keys correctness)
- `src/components/forms/timekeeping/manual-entry-grid.tsx:251` — `key={idx}` over `row.intervals`.

> **Status: FIXED** — intervals carry a generated `id` and updates match on it, not the array index.
Removing or reordering an interval shifts values and focus to the neighbouring input because React reuses the DOM by position.
**Fix:** give each interval a generated id (`crypto.randomUUID()` on add).
- `src/components/nav/nav-breadcrumb.tsx:50,78` uses index keys too, but those lists are static — acceptable.

### F7. `new Date()` in initial state and render (rendering-hydration-no-flicker)
- `src/app/dashboard/payroll/opening-balances/page.tsx:46` — `useState(new Date().getFullYear())`
- same file `:136` — `new Date().toISOString().slice(0,10)` inside JSX
- `src/components/forms/employees/form-position-history.tsx:688` — `new Date().getFullYear()` in props

> **Status: DEFERRED** — client components are SSR'd either way; a mount-effect fix trades a once-a-year mismatch for a permanent first-paint flicker.
Client components are still server-rendered, so these can disagree across a midnight/year boundary and re-render with a different value.
**Fix:** compute in an effect or `useState(() => ...)` on the client only, or pass the date from the server.

---

## Low impact

### F8. Sequential independent awaits (async-parallel)
- `convex/actions.ts:35-50` — `_getMembership`, then `_getUserByEmail`, then `bcrypt.hash`.

> **Status: FIXED** — membership and email lookups run in `Promise.all`, same error precedence.
The two lookups are independent; `Promise.all` halves the round trips. Rare admin path, so low priority. Keep `bcrypt.hash` after the duplicate check.

### F9. Repeated `format()` per table row (js-cache-function-results)
- `src/components/data-table/employees/data-table.tsx:134` and 3 other files call `format(new Date(x), "MMM d, yyyy")` inside `.map`.

> **Status: DEFERRED** — the four call sites use three different formats (`PPP`, `yyyy-MM-dd HH:mm`, `MMM d, yyyy`); an `Intl` swap would change display semantics for no measurable gain.
Minor; a module-level `Intl.DateTimeFormat` is cheaper and avoids re-parsing the pattern per row.

### F10. 20 declared dependencies with no import site (not a skill rule — bundle hygiene)
`recharts`, `@dnd-kit/*` (4), `next-mdx-remote`, `sugar-high`, `react-medium-image-zoom`, `cmdk`, `@hookform/devtools`, `@date-fns/tz`, `@date-fns/utc`, and 8 `@radix-ui/react-*` packages are in `package.json` but never imported under `src/` or `convex/`. They cost install time, audit surface, and confuse bundle analysis. (`react-dom` is a false positive — Next uses it implicitly.)

> **Status: BLOCKED** — removing deps needs `pnpm install` to refresh the lockfile, which this host cannot run.
### F11. Template leftovers (correctness, not performance)
- `src/app/layout.tsx:48` — `<PlausibleProvider domain="template.openstatus.dev">`. Analytics from HRX is reported against the openstatus template domain, not HRX.
- `src/components/feedback.tsx:53` — leftover `console.log(values)` in the submit path.

> **Status: FIXED** — analytics is opt-in via `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`; no template domain ships; the stray `console.log` is removed.
### F12. Next.js 16 standard: `middleware` is deprecated
- `src/middleware.ts` — renamed to `proxy.ts` in Next 16 (`v16.0.0` in the Next docs version history). Still works in 16.1.6 with a deprecation warning.
**Fix:** `npx @next/codemod@latest middleware-to-proxy` (renames the file and the exported function), then re-run the route-protection tests.

> **Status: FIXED** — file moved to `src/proxy.ts`; `AGENTS.md` updated to match.
### F13. `AGENTS.md` is out of date (docs drift that misleads agents)
`AGENTS.md` states `next.config.ts` "currently has `output: "export"`" and warns to remove it before adding server features. The actual config is `output: "standalone"` with Turbopack filesystem caching. Any agent trusting the doc will reason from a false premise.

> **Status: FIXED** — `AGENTS.md` now describes `output: "standalone"` and documents the analytics env var.
---

## Already healthy against the rule set

- `startTransition` is used for mutations throughout (`useTransition` in every form/table); no manual `useState` loading flags for async work.
- No `fetch()` in effects, no client-side waterfalls — Convex `useQuery` handles subscriptions and dedup.
- No heavy client libraries actually bundled: `recharts`, `dnd-kit`, and MDX are declared but unimported, so `next/dynamic` is not yet needed.
- `time/page.tsx` derives filters/sorts in `useMemo`, builds an id→name map (js-index-maps), sorts a copy, and skips queries with `"skip"` — textbook.
- Async route params are handled correctly (`params: Promise<...>` + `await params` in `(auth)/invite/[token]`), matching Next 15+/16.
- `next/font` with subsets, `output: "standalone"`, no `<img>` tags, no `useSearchParams` without Suspense.

## Suggested order

1. F11 (`Plausible` domain) — one-line correctness fix.
2. F1, F3 — cheap memo/callback fixes with immediate re-render wins.
3. F2, F4 — state-shape changes; do them together with F6's interval ids.
4. F12 + F13 — Next 16 housekeeping, then re-run `pnpm lint`/`pnpm tsc` in CI.
5. F5 — only if route latency becomes a reported problem.
