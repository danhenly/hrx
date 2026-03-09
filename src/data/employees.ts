import type { Doc } from "../../convex/_generated/dataModel";

export type Employee = Doc<"employees">;
export type EmployeePosition = Doc<"employeePositions">;

export type EmployeeWithPosition = Employee & {
  currentPosition: EmployeePosition | null;
};

export type EmployeeWithHistory = Employee & {
  positions: EmployeePosition[];
};

export const EMPLOYEE_STATUSES = [
  { value: "active", label: "Active" },
  { value: "terminated", label: "Terminated" },
  { value: "on_leave", label: "On Leave" },
] as const;
