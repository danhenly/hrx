// Loan amortisation (P5.3, D9).
//
// Order is a contract: statutory contributions, then withholding tax, then STATUTORY
// loans (SSS, Pag-IBIG), then company loans and advances. Nothing here ever reduces a
// scheduled payment to make the numbers fit — a silently short amortisation is how an
// employee ends up with an unresolved agency balance and a labour complaint.
//
// When the schedule cannot be met the run REFUSES that payslip and reports it, with a
// "defer amortisation" adjustment as the approver's explicit way out.
import type { Money, PayslipLine } from "./types";

export type LoanType = "sss" | "pagibig" | "company" | "advance";

export type LoanState = {
    id: string;
    type: LoanType;
    /** Outstanding balance, centavos. */
    balanceCentavos: Money;
    /** What this period's schedule asks for, centavos. */
    amortisationCentavos: Money;
    reference?: string;
};

/** Lower runs first. Statutory loans are collected before the employer's own. */
export function loanPriority(type: LoanType): number {
    switch (type) {
        case "sss":
            return 0;
        case "pagibig":
            return 1;
        case "company":
            return 2;
        case "advance":
            return 3;
    }
}

export type LoanPlan = {
    payments: { loanId: string; type: LoanType; amountCentavos: Money; balanceAfter: Money }[];
    lines: PayslipLine[];
    /** Set when the schedule cannot be met without taking net pay below zero. */
    blocked?: { code: string; reason: string };
};

export const LOAN_SHORTFALL = "LOAN_SHORTFALL";

/**
 * Plan this period's loan deductions.
 *
 * `availableCentavos` is net pay before loans. Once a scheduled payment would push
 * that below zero the whole payslip is blocked: paying some loans and skipping others
 * without a decision is worse than stopping, because the shortfall silently lands on
 * whichever agency was last in the list.
 */
export function planLoanPayments(args: {
    loans: LoanState[];
    availableCentavos: Money;
}): LoanPlan {
    const ordered = [...args.loans].sort(
        (a, b) => loanPriority(a.type) - loanPriority(b.type) || a.id.localeCompare(b.id),
    );

    let available = args.availableCentavos;
    const payments: LoanPlan["payments"] = [];
    const lines: PayslipLine[] = [];

    for (const loan of ordered) {
        const due = Math.min(loan.amortisationCentavos, loan.balanceCentavos);
        if (due <= 0) continue;

        if (due > available) {
            return {
                payments,
                lines,
                blocked: {
                    code: LOAN_SHORTFALL,
                    reason: `Net pay cannot cover the ${loan.type.toUpperCase()} loan (needs ${(due / 100).toFixed(2)}, ${(available / 100).toFixed(2)} available). Reduce or defer the amortisation with an explicit adjustment, or the payslip cannot be computed.`,
                },
            };
        }

        available -= due;
        payments.push({
            loanId: loan.id,
            type: loan.type,
            amountCentavos: due,
            balanceAfter: loan.balanceCentavos - due,
        });
        lines.push({
            kind: "deduction",
            code: `${loan.type.toUpperCase()}_LOAN`,
            description: `Loan amortisation${loan.reference ? ` (${loan.reference})` : ""}`,
            amount: due,
            taxable: false,
            source: { type: "loanAccount", id: loan.id },
        });
    }

    return { payments, lines };
}
