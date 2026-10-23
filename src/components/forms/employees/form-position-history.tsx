"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { EmployeePosition } from "@/data/employees";
import { cn } from "@/lib/utils";
import { useActiveOrg } from "@/providers/org-provider";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const addPositionSchema = z.object({
    positionId: z.string().min(1, "Position is required"),
    salary: z.coerce
        .number()
        .positive("Must be positive")
        .optional()
        .or(z.literal("")),
    effectiveDate: z.date({ required_error: "Effective date is required" }),
    notes: z.string().optional(),
});

type AddPositionValues = z.infer<typeof addPositionSchema>;

interface FormPositionHistoryProps {
    employeeId: Id<"employees">;
    positions: EmployeePosition[];
    isAdmin: boolean;
    orgId: Id<"organizations"> | undefined;
}

export function FormPositionHistory({
    employeeId,
    positions,
    isAdmin,
    orgId,
}: FormPositionHistoryProps) {
    const addPosition = useMutation(api.employees.addPosition);
    const masterlist = useQuery(
        api.positions.list,
        orgId ? { orgId, includeInactive: true } : "skip",
    );
    const activePositions = (masterlist ?? []).filter((p) => p.isActive);
    const positionById = new Map(
        (masterlist ?? []).map((p) => [p._id as string, p]),
    );
    const removePosition = useMutation(api.employees.removePosition);
    const [isAddPending, startAddTransition] = useTransition();
    const [isDeletePending, startDeleteTransition] = useTransition();

    const form = useForm<AddPositionValues>({
        resolver: zodResolver(addPositionSchema),
        defaultValues: {
            positionId: "",
            salary: "",
            effectiveDate: new Date(),
            notes: "",
        },
    });

    function handleAdd(values: AddPositionValues) {
        if (isAddPending) return;
        startAddTransition(async () => {
            try {
                await addPosition({
                    employeeId,
                    positionId: values.positionId as Id<"positions">,
                    salary:
                        values.salary !== "" && values.salary !== undefined
                            ? Number(values.salary)
                            : undefined,
                    effectiveDate: values.effectiveDate.getTime(),
                    notes: values.notes || undefined,
                });
                toast.success("Position added");
                form.reset({
                    positionId: "",
                    salary: "",
                    effectiveDate: new Date(),
                    notes: "",
                });
            } catch (err) {
                toast.error((err as Error).message ?? "Failed to add position");
            }
        });
    }

    function handleDelete(positionId: Id<"employeePositions">) {
        startDeleteTransition(async () => {
            try {
                await removePosition({ positionId });
                toast.success("Position removed");
            } catch (err) {
                toast.error((err as Error).message ?? "Failed to remove position");
            }
        });
    }

    // Sort descending by effectiveDate so most recent is first
    const sorted = [...positions].sort(
        (a, b) => b.effectiveDate - a.effectiveDate,
    );

    return (
        <div className="space-y-4 px-4 py-4">
            {/* History list */}
            {sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No position history yet.
                </p>
            ) : (
                <div className="space-y-2">
                    {sorted.map((pos, idx) => (
                        <div
                            key={pos._id}
                            className="rounded-md border p-3 text-sm space-y-1"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 font-medium">
                                        <Input
                                            readOnly
                                            value={pos.jobTitle}
                                            aria-label="Job title (recorded)"
                                            className="h-8 w-auto cursor-default border-transparent bg-muted/40 text-muted-foreground px-2"
                                        />
                                        {idx === 0 && !pos.endDate && (
                                            <Badge variant="default" className="text-xs h-5">
                                                Current
                                            </Badge>
                                        )}
                                        {pos.positionId &&
                                            positionById.get(pos.positionId)?.isActive ===
                                                false && (
                                                <Badge variant="secondary" className="text-xs h-5">
                                                    Inactive
                                                </Badge>
                                            )}
                                    </div>
                                    {pos.department && (
                                        <div className="text-muted-foreground">
                                            {pos.department}
                                        </div>
                                    )}
                                    <div className="text-muted-foreground text-xs">
                                        {format(new Date(pos.effectiveDate), "MMM d, yyyy")}
                                        {pos.endDate
                                            ? ` → ${format(new Date(pos.endDate), "MMM d, yyyy")}`
                                            : " → Present"}
                                    </div>
                                    {pos.salary !== undefined && (
                                        <div className="text-muted-foreground text-xs">
                                            Salary:{" "}
                                            {new Intl.NumberFormat("en-PH", {
                                                style: "currency",
                                                currency: "PHP",
                                                maximumFractionDigits: 0,
                                            }).format(pos.salary)}
                                        </div>
                                    )}
                                    {pos.notes && (
                                        <div className="text-muted-foreground text-xs italic">
                                            {pos.notes}
                                        </div>
                                    )}
                                </div>
                                {isAdmin && (
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                                        onClick={() =>
                                            handleDelete(pos._id as Id<"employeePositions">)
                                        }
                                        disabled={isDeletePending}
                                        aria-label="Remove position"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Separator />

            {/* Add new position */}
            <Collapsible>
                <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add position
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                    <Form {...form}>
                        <form
                            onSubmit={form.handleSubmit(handleAdd)}
                            className="space-y-3 rounded-md border p-3"
                        >
                            {activePositions.length === 0 ? (
                                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                    No active positions yet — add them under{" "}
                                    <a
                                        className="underline"
                                        href="/dashboard/settings/positions"
                                    >
                                        Settings → Positions
                                    </a>{" "}
                                    first.
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="positionId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Position</FormLabel>
                                                <FormControl>
                                                    <select
                                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none"
                                                        value={field.value}
                                                        onChange={field.onChange}
                                                        aria-label="Position"
                                                    >
                                                        <option value="">Select a position…</option>
                                                        {activePositions.map((pos) => (
                                                            <option
                                                                key={pos._id}
                                                                value={pos._id}
                                                            >
                                                                {pos.name}
                                                                {pos.department
                                                                    ? ` · ${pos.department}`
                                                                    : ""}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormItem>
                                        <FormLabel>Department</FormLabel>
                                        <FormControl>
                                            <Input
                                                readOnly
                                                value={
                                                    positionById.get(
                                                        form.watch("positionId"),
                                                    )?.department ?? ""
                                                }
                                                aria-label="Department (from position)"
                                                className="cursor-default bg-muted/40 text-muted-foreground"
                                            />
                                        </FormControl>
                                    </FormItem>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="salary"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Annual salary (PHP)</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    placeholder="360000"
                                                    {...field}
                                                    value={field.value ?? ""}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="effectiveDate"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col">
                                            <FormLabel>Effective date</FormLabel>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button
                                                            variant="outline"
                                                            className={cn(
                                                                "w-full pl-3 text-left font-normal",
                                                                !field.value && "text-muted-foreground",
                                                            )}
                                                        >
                                                            {field.value
                                                                ? format(field.value, "PPP")
                                                                : "Pick a date"}
                                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                        </Button>
                                                    </FormControl>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0" align="start">
                                                    <Calendar
                                                        mode="single"
                                                        selected={field.value}
                                                        onSelect={field.onChange}
                                                        captionLayout="dropdown"
                                                        fromYear={1950}
                                                        toYear={new Date().getFullYear() + 1}
                                                        initialFocus
                                                    />
                                                </PopoverContent>
                                            </Popover>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="notes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Notes</FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder="Promotion, transfer reason, etc."
                                                className="resize-none"
                                                rows={2}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <Button
                                type="submit"
                                size="sm"
                                disabled={isAddPending || activePositions.length === 0}
                            >
                                {isAddPending ? "Saving…" : "Save position"}
                            </Button>
                        </form>
                    </Form>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
