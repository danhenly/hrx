"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { EMPLOYEE_STATUSES, type Employee } from "@/data/employees";
import { cn } from "@/lib/utils";

const schema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    phone: z.string().optional(),
    dateOfBirth: z.date().optional(),
    hireDate: z.date({ required_error: "Hire date is required" }),
    status: z.enum(["active", "terminated", "on_leave"]),
});

export type EmployeeProfileValues = z.infer<typeof schema>;

interface FormEmployeeProfileProps {
    defaultValues?: Partial<Employee>;
    onSubmit: (values: EmployeeProfileValues) => Promise<void>;
    submitLabel?: string;
}

export function FormEmployeeProfile({
    defaultValues,
    onSubmit,
    submitLabel = "Save",
}: FormEmployeeProfileProps) {
    const [isPending, startTransition] = useTransition();

    const form = useForm<EmployeeProfileValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            firstName: defaultValues?.firstName ?? "",
            lastName: defaultValues?.lastName ?? "",
            email: defaultValues?.email ?? "",
            phone: defaultValues?.phone ?? "",
            dateOfBirth: defaultValues?.dateOfBirth
                ? new Date(defaultValues.dateOfBirth)
                : undefined,
            hireDate: defaultValues?.hireDate
                ? new Date(defaultValues.hireDate)
                : undefined,
            status: defaultValues?.status ?? "active",
        },
    });

    function handleSubmit(values: EmployeeProfileValues) {
        if (isPending) return;
        startTransition(async () => {
            try {
                await onSubmit(values);
                toast.success("Employee profile saved");
            } catch (err) {
                toast.error((err as Error).message ?? "Failed to save");
            }
        });
    }

    return (
        <Form {...form}>
            <form
                id="employee-profile-form"
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-4 px-4 py-4"
            >
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>First name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Jane" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Last name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Smith" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input
                                    type="email"
                                    placeholder="jane.smith@company.com"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                                <Input placeholder="+1 555 000 1234" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="dateOfBirth"
                        render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Date of birth</FormLabel>
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
                                            defaultMonth={
                                                field.value ?? new Date(new Date().getFullYear() - 30, 0)
                                            }
                                            disabled={(date) => date > new Date()}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="hireDate"
                        render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Hire date</FormLabel>
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
                                            defaultMonth={field.value ?? new Date()}
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
                    name="status"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Status</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {EMPLOYEE_STATUSES.map((s) => (
                                        <SelectItem key={s.value} value={s.value}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <Button type="submit" className="w-full" disabled={isPending}>
                    {isPending ? "Saving…" : submitLabel}
                </Button>
            </form>
        </Form>
    );
}
