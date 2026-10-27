import type { Doc } from "../../convex/_generated/dataModel";

export type Position = Doc<"positions">;
export type PositionWithUsage = Position & { usageCount: number };
