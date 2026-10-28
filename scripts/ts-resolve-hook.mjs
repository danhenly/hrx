/**
 * ESM resolve hook for the fixture runner.
 *
 * ESM does no extension search, and Convex's own typecheck rejects explicit `.ts`
 * specifiers (TS5097), so the payroll source keeps the repo's extensionless
 * imports and this hook supplies the extension at RUN time only. It affects
 * nothing in the app build — it is loaded by scripts/payroll-fixtures.mjs alone.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.(ts|mjs|js|json)$/.test(specifier)) {
        const base = new URL(specifier, context.parentURL);
        for (const suffix of [".ts", "/index.ts"]) {
            const candidate = new URL(`${base.href}${suffix}`);
            if (existsSync(fileURLToPath(candidate))) {
                return nextResolve(candidate.href, context);
            }
        }
    }
    return nextResolve(specifier, context);
}
