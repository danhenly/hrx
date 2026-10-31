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
/** A department that exists only as text (predates the master list, never normalised). */
const LEGACY_DEPARTMENT = "__legacy";

const positionSchema = z.object({
  name: z.string().min(2, "At least 2 characters").max(80, "80 characters or fewer"),
  departmentId: z.string().optional(),
  description: z.string().optional(),
});

type FormPositionPropsDepartment = {
  /** Display text of the department as recorded (used when it has no master-list link). */
  department?: string;
};

type PositionValues = z.infer<typeof positionSchema>;

interface FormPositionProps {
  orgId: Id<"organizations">;
  positionId?: Id<"positions">; // absent = create
  defaultValues?: Partial<PositionValues> & FormPositionPropsDepartment;
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

  // A row whose department is plain text must NOT be silently cleared by opening this form:
  // the select would show "No department" and submit empty. It gets its own option instead,
  // and submits the text unchanged so nothing is lost before "Normalise" runs.
  const legacyDepartment =
    !defaultValues?.departmentId && defaultValues?.department ? defaultValues.department : null;

  const form = useForm<PositionValues>({
    resolver: zodResolver(positionSchema),
    defaultValues: {
      name: "",
      description: "",
      ...defaultValues,
      departmentId: defaultValues?.departmentId ?? (legacyDepartment ? LEGACY_DEPARTMENT : undefined),
    },
  });

  function handleSubmit(values: PositionValues) {
    if (isPending) return;
    const isLegacy = values.departmentId === LEGACY_DEPARTMENT;
    const departmentId =
      values.departmentId && values.departmentId !== NO_DEPARTMENT && !isLegacy
        ? (values.departmentId as Id<"departments">)
        : undefined;

    startTransition(async () => {
      try {
        if (positionId) {
          await updatePosition({
            positionId,
            name: values.name,
            // `undefined` on an edit would leave the old department in place, so a cleared
            // selection is sent as an explicit empty string; a legacy row sends its text back.
            department: isLegacy ? (defaultValues?.department ?? "") : departmentId ? undefined : "",
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
                  {legacyDepartment && (
                    <SelectItem value={LEGACY_DEPARTMENT}>
                      {legacyDepartment} (not linked — run Normalise)
                    </SelectItem>
                  )}
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
