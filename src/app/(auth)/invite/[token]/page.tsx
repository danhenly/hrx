import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormSignUp } from "@/components/forms/auth/form-sign-up";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "../../../../../convex/_generated/api";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const invitation = await fetchQuery(api.invitations.getByToken, { token });

  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.expiresAt < Date.now()
  ) {
    notFound();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>You&apos;ve been invited</CardTitle>
        <CardDescription>
          Join <strong>{invitation.org?.name}</strong> as{" "}
          <strong>{invitation.role}</strong>. Create your account below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormSignUp invitationToken={token} prefilledEmail={invitation.email} />
      </CardContent>
    </Card>
  );
}
