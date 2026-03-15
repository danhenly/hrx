# Timekeeping Module Plan

## Goals and Principles
- Deliver org-scoped time tracking with approvals, payroll export, and auditability.
- Follow Convex guard stack: `requireAuth` → `requireMembership` → `requireAdmin` for admin-only writes.
- Keep data multi-tenant by scoping every table with `orgId` and using `membership` role checks.
- Prefer incremental delivery: schema first, then backend API, then UI flows, with feature flags/toggles where useful.

## Scope (Initial Release)
- Core: Manual time entry grid (per-date rows, up to 3 time-in/out pairs per row), weekly timesheets, approvals, basic reporting.
- Roles: `admin` (configure, approve), `hr` (view reports), members (log time, submit their own rows).
- Integrations: export CSV for payroll; no third-party API push in v1.
- Compliance: capture audit trail (who created/edited/approved), prevent cross-org access, keep soft deletes optional.

## Data Model (Convex `schema.ts`)
- `time_entries`: `orgId`, `memberId`, `date`, `intervals` (array length ≤ 3 of `{ start, end, durationMinutes }`), `totalMinutes`, `notes?`, `source (manual)`, `status (draft|submitted|approved|rejected)`, `timesheetId?`, audit fields (`createdBy`, `updatedBy`, timestamps).
- `timesheets`: `orgId`, `memberId`, `weekStart (date)`, `status (open|submitted|approved|rejected|locked)`, `submittedAt?`, `approvedAt?`, `approvedBy?`, `rejectedReason?`, totals (worked minutes), timestamps.
- `audits`: `orgId`, `entityType`, `entityId`, `action`, `actorId`, `changes`, `at` (append-only). Can be reused if a general audit table exists.
- Indices: per table on `orgId`, plus `memberId` for entries/timesheets, composite (`orgId`, `date`, `memberId`) for quick lookup; avoid cross-org scans.

## Convex Functions (per HRX conventions)
- `timeEntries.ts`: `listByDateRange(memberId?, dateRange)`, `upsertForDay` (create/update a row with up to 3 intervals), `submit`, `approve` (admin), `reject` (admin with reason), `deleteDraft` (admin|owner before submit). Ensure guards use `requireMembership`; approvals use `requireAdmin`.
- `timesheets.ts`: `getOrCreateCurrent(memberId)`, `submit`, `approve` (admin), `reject` (admin with reason), `lock` (admin for payroll export), `listForOrg(filter by status/date range)`.
- `reports.ts`: `weeklySummary(orgId, range)`, `memberSummary(memberId, range)`, `payrollExport(range)` returning CSV rows. Read-only queries with membership guard; exports admin-only.
- `audit.ts`: append-only logging helper called from mutations; ensure no PII leakage across orgs.

## UX Flows (Next.js App Router)
- Navigation: add "Time" or "Timekeeping" entry in dashboard sidebar.
- Pages:
  - `/dashboard/time`: overview cards (this week hours, pending approvals, recent entries).
  - `/dashboard/time/entries`: manual grid for multi-row entry. Each row has employee dropdown, date picker, up to 3 time in/out pairs, notes, status chip. Actions: add row, remove row, edit draft, submit.
  - `/dashboard/time/timesheets`: current user view + admins can switch member.
  - `/dashboard/time/approvals`: admin-only queue showing submitted timesheets/entries.
- Components:
  - Manual entry grid row component (employee select, date, 3 start/end pairs, notes, add/remove row controls).
  - Week calendar/summary with total hours per member.
  - Approval action bar (approve/reject with reason, lock).
  - Export modal (CSV by date range).
- State: client components using `useQuery`/`useMutation`; use `useTransition` for pending states.

## Validation and Business Rules
- Prevent overlapping intervals within a row and across rows for the same member and date; max 3 intervals per row.
- All intervals must have `start < end`; cross-midnight intervals are allowed but counted entirely on the date of `start`.
- Duration derived from intervals; `totalMinutes` must equal the sum of interval durations and be > 0.
- Status transitions: `draft → submitted → approved|rejected`; only `approved` timesheets can be `locked`; rejected returns to `draft` with reason.
- Editing rules: drafts editable by owner; submitted editable by admin only; approved/locked immutable except admin reject/unlock path (audit every change).

## Reporting and Export
- Built-in queries for weekly and member summaries (minutes totals per member/date).
- CSV export action: columns (member, date, up to 3 start/end pairs, total duration, status, notes). Guard with admin, scoped by org.
- Consider background action for large exports if query size grows; start with direct query + streamed response from Next route if `output: "export"` is removed later.

## Audit and Compliance
- Every write mutation appends to `audits` with actor, action, before/after snapshot (redact notes if sensitive).
- Show audit trail on entry and timesheet detail for admins.

## Performance and Limits
- Paginate entry lists (e.g., 50 per page) and filter by date range.
- Use indices noted above; avoid cross-org scans.
- Consider bounding max entry length (e.g., 16 hours) to avoid data errors.

## Rollout Plan
1) Schema additions for manual intervals + `npx convex dev --once` to regen types.
2) Implement Convex functions with guards and audit hooks.
3) Add sidebar nav + overview page with stub data to unblock UI.
4) Build manual entry grid (multi-row, employee dropdown, up to 3 intervals) + week view; wire to Convex queries/mutations.
5) Add approvals queue + status transitions.
6) Add reporting/export.
7) Add tests/checks: `pnpm lint`, `pnpm tsc`, Convex typegen CI.

## Open Questions
- Do we need geolocation/IP capture for compliance?
- How do we handle holidays/overtime rules per org (phase 2)?
