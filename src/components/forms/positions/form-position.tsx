"use client";

import { useMutation } from "convex/react";
import { useTransition } from "react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const positionSchema = z.object({
    name: z.string().min(2, "At least 2 characters").max(80, "80 characters or fewer"),
    department: z.string().optional(),
    description: z.string().optional(),
});

type PositionValues = z.infer<typeof positionSchema>;

interface FormPositionProps {
    orgId: Id<"organizations">;
    positionId?: Id<"positions">;      // absent = create
    defaultValues?: Partial<PositionValues>;
    onDone?: () => void;
}

export function FormPosition({
    orgId,
    positionId,
    defaultValues,
    onDone,
}: FormPositionProps) {
    const createPosition = useMutation(api.positions.create);
    const updatePosition = useMutation(api.positions.update);
    const [isPending, startTransition] = useTransition();

    const form = useForm<PositionValues>({
        resolver: zodResolver(positionSchema),
        defaultValues: { name: "", department: "", description: "", ...defaultValues },
    });

    function handleSubmit(values: PositionValues) {
        if (isPending) return;
        startTransition(async () => {
            try {
                if (positionId) {
                    await updatePosition({ positionId, ...values });
                    toast.success("Position updated");
                } else {
                    await createPosition({ orgId, ...values });
                    toast.success("Position added");
                }
                form.reset(values);
                onDone?.();
            } catch (err) {
                toast.error((err as Error).message ?? "Failed to save position");
            }
        });
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 px-4 py-4">
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input placeholder="Staff" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Department (optional)</FormLabel>
                            <FormControl>
                                <Input placeholder="Operations" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Description (optional)</FormLabel>
                            <FormControl>
                                <Textarea className="resize-none" rows={3} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <button type="submit" disabled={isPending} className="text-sm underline">
                    {isPending ? "Saving…" : positionId ? "Save changes" : "Add position"}
                </button>
            </form>
        </Form>
    );
}
