"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const schema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

interface FormSignUpProps {
  /** When provided, the sign-up joins an existing org instead of creating one. */
  invitationToken?: string;
  /** Pre-fill, read-only email for invite flows. */
  prefilledEmail?: string;
}

export function FormSignUp({
  invitationToken,
  prefilledEmail,
}: FormSignUpProps) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: prefilledEmail ?? "",
      password: "",
      confirmPassword: "",
    },
  });

  function onSubmit(values: FormValues) {
    if (isPending) return;
    startTransition(async () => {
      try {
        await signIn("password", {
          flow: "signUp",
          name: values.name,
          email: values.email,
          password: values.password,
          // Passed to createOrUpdateUser callback to skip auto-org creation
          ...(invitationToken ? { invitationToken } : {}),
        });

        // If joining via invite, accept the invitation before routing
        if (invitationToken) {
          // acceptInvitation will be called by the invite page after sign-up
          router.push(`/invite/${invitationToken}/accept`);
        } else {
          router.push("/dashboard");
        }
      } catch {
        toast.error(
          "Could not create account. The email may already be in use.",
        );
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input placeholder="Jane Smith" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  readOnly={Boolean(prefilledEmail)}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </Form>
  );
}
