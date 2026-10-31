// Department normalisation (P12) — pure, no ctx.
//
// "Normalise" here means one thing only: the same department typed several ways becomes ONE
// department. It does not rename anything — "Engg" and "Engineering" stay separate, because
// merging them is a human decision, not a string rule.

/** Identity of a department: lowercase, single-spaced, no trailing punctuation. */
export function departmentKey(raw: string): string {
    return raw
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[.,;:]+$/g, "")
        .toLowerCase();
}

/** How a department is displayed: trimmed and single-spaced, casing untouched. */
export function departmentDisplay(raw: string): string {
    return raw.trim().replace(/\s+/g, " ").replace(/[.,;:]+$/g, "");
}

export interface DepartmentUsage {
    raw: string;
    count: number;
}

/**
 * Collapse messy values into canonical departments.
 *
 * The display name is the MOST COMMON existing spelling for that key (ties broken
 * alphabetically so a re-run is idempotent). No casing is invented — "MIS" stays "MIS".
 */
export function planDepartments(values: string[]): {
    departments: { key: string; display: string; count: number }[];
    renames: { from: string; to: string }[];
} {
    const byKey = new Map<string, Map<string, number>>();
    for (const raw of values) {
        if (!raw || raw.trim().length === 0) continue;
        const key = departmentKey(raw);
        if (key.length === 0) continue;
        const display = departmentDisplay(raw);
        const variants = byKey.get(key) ?? new Map<string, number>();
        variants.set(display, (variants.get(display) ?? 0) + 1);
        byKey.set(key, variants);
    }

    const departments: { key: string; display: string; count: number }[] = [];
    const renames: { from: string; to: string }[] = [];

    for (const [key, variants] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const ranked = [...variants.entries()].sort((a, b) =>
            b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
        );
        const [display, count] = ranked[0];
        const total = ranked.reduce((sum, entry) => sum + entry[1], 0);
        departments.push({ key, display, count: total });
        for (const variant of ranked.map(([name]) => name)) {
            if (variant !== display) renames.push({ from: variant, to: display });
        }
    }

    return { departments, renames };
}
