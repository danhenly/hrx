"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAction, useMutation, useQuery } from "convex/react";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardSeparator,
  FormCardTitle,
} from "@/components/forms/form-card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { api } from "../../../../convex/_generated/api";

// ─── Invite schema ────────────────────────────────────────────────────────────
const inviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "hr"]),
});
type InviteValues = z.infer<typeof inviteSchema>;

// ─── Direct create schema ─────────────────────────────────────────────────────
const directSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Minimum 8 characters"),
  role: z.enum(["admin", "hr"]),
});
type DirectValues = z.infer<typeof directSchema>;

export function FormTeam() {
  const org = useQuery(api.organizations.getMyOrg);
  const orgId = org?._id;
  const members = useQuery(api.users.listMembers, orgId ? { orgId } : "skip");
  const invitations = useQuery(api.invitations.listByOrg, orgId ? { orgId } : "skip");
  const createInvitation = useMutation(api.invitations.create);
  const createDirect = useAction(api.actions.createDirectUser);
  const removeMember = useMutation(api.users.removeMember);
  const revokeInvitation = useMutation(api.invitations.revoke);

  const [isInvitePending, startInviteTransition] = useTransition();
  const [isDirectPending, startDirectTransition] = useTransition();

  const inviteForm = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "hr" },
  });

  const directForm = useForm<DirectValues>({
    resolver: zodResolver(directSchema),
    defaultValues: { name: "", email: "", password: "", role: "hr" },
  });

  function onInviteSubmit(values: InviteValues) {
    if (isInvitePending || !orgId) return;
    startInviteTransition(async () => {
      try {
        const { token } = await createInvitation({ ...values, orgId });
        const inviteUrl = `${window.location.origin}/invite/${token}`;
        await navigator.clipboard.writeText(inviteUrl);
        toast.success("Invitation created — link copied to clipboard!");
        inviteForm.reset();
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to create invitation");
      }
    });
  }

  function onDirectSubmit(values: DirectValues) {
    if (isDirectPending || !orgId) return;
    startDirectTransition(async () => {
      try {
        await createDirect({ ...values, orgId });
        toast.success(`Account created for ${values.email}`);
        directForm.reset();
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to create user");
      }
    });
  }

  return (
    <FormCard>
      <FormCardHeader>
        <FormCardTitle>Team</FormCardTitle>
        <FormCardDescription>Manage your organisation members.</FormCardDescription>
      </FormCardHeader>
      <FormCardContent>
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="pending">Pending invites</TabsTrigger>
          </TabsList>

          {/* Members table */}
          <TabsContent value="members">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members ?? []).map((m) => (
                  <TableRow key={m._id}>
                    <TableCell>{m.user?.name ?? "—"}</TableCell>
                    <TableCell>{m.user?.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember({ memberId: m._id })}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          {/* Pending invitations table */}
          <TabsContent value="pending">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invitations ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground text-center py-6">
                      No pending invitations
                    </TableCell>
                  </TableRow>
                )}
                {(invitations ?? []).map((inv) => (
                  <TableRow key={inv._id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell><Badge variant="outline">{inv.role}</Badge></TableCell>
                    <TableCell>
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          revokeInvitation({
                            invitationId: inv._id,
                          })
                        }
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </FormCardContent>

      <FormCardSeparator />

      {/* ── Invite via email ─────────────────────────────────────────── */}
      <FormCardHeader>
        <FormCardTitle>Invite via email</FormCardTitle>
        <FormCardDescription>
          Send an invite link the user can use to set up their own password.
        </FormCardDescription>
      </FormCardHeader>
      <FormCardContent>
        <Form {...inviteForm}>
          <form
            onSubmit={inviteForm.handleSubmit(onInviteSubmit)}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <FormField
              control={inviteForm.control}
              name="email"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="employee@company.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={inviteForm.control}
              name="role"
              render={({ field }) => (
                <FormItem className="w-32">
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isInvitePending}>
              {isInvitePending ? "Sending…" : "Send invite"}
            </Button>
          </form>
        </Form>
      </FormCardContent>

      <FormCardSeparator />

      {/* ── Direct credential creation ────────────────────────────────── */}
      <FormCardHeader>
        <FormCardTitle>Create user directly</FormCardTitle>
        <FormCardDescription>
          Set the email and password yourself. Share the credentials with the
          employee — they can change their password after first sign-in.
        </FormCardDescription>
      </FormCardHeader>
      <FormCardContent>
        <Form {...directForm}>
          <form
            onSubmit={directForm.handleSubmit(onDirectSubmit)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <FormField
              control={directForm.control}
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
              control={directForm.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={directForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="jane@company.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={directForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={isDirectPending}>
                {isDirectPending ? "Creating…" : "Create user"}
              </Button>
            </div>
          </form>
        </Form>
      </FormCardContent>
      <FormCardFooter>
        <FormCardFooterInfo>
          Only admins can add or remove team members.
        </FormCardFooterInfo>
      </FormCardFooter>
    </FormCard>
  );
}
