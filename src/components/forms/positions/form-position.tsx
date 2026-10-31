"use client";

import { useMutation, useQuery } from "convex/react";
import { useTransition } from "react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** Radix Select cannot carry an empty value, so "no department" needs a sentinel. */
const NO_DEPARTMENT = "__none";

const positionSchema = z.object({
  name: z.string().min(2, "At least 2 characters").max(80, "80 characters or fewer"),
  departmentId: z.string().optional(),
  description: z.string().optional(),
});

type PositionValues = z.infer<typeof positionSchema>;

interface FormPositionProps {
  orgId: Id<"organizations">;
  positionId?: Id<"positions">; // absent = create
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
  const departments = useQuery(api.departments.list, { orgId });
  const [isPending, startTransition] = useTransition();

  const form = useForm<PositionValues>({
    resolver: zodResolver(positionSchema),
    defaultValues: { name: "", description: "", ...defaultValues },
  });

  function handleSubmit(values: PositionValues) {
    if (isPending) return;
    const departmentId =
      values.departmentId && values.departmentId !== NO_DEPARTMENT
        ? (values.departmentId as Id<"departments">)
        : undefined;

    startTransition(async () => {
      try {
        if (positionId) {
          await updatePosition({
            positionId,
            name: values.name,
            // `undefined` on an edit would leave the old department in place, so a cleared
            // selection is sent as an explicit empty string.
            department: departmentId ? undefined : "",
            departmentId,
            description: values.description,
          });
          toast.success("Position updated");
        } else {
          await createPosition({
            orgId,
            name: values.name,
            departmentId,
            description: values.description,
          });
          toast.success("Position added");
        }
        form.reset({ ...values });
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
          name="departmentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department (optional)</FormLabel>
              <Select
                value={field.value && field.value.length > 0 ? field.value : NO_DEPARTMENT}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="No department" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                  {(departments ?? []).map((department) => (
                    <SelectItem key={department._id} value={department._id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Departments are a master list on this page, so a job title cannot invent one.
              </FormDescription>
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
