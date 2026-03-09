"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";

/**
 * This page finalises the invitation after the user has signed up.
 * It calls `invitations.accept` and redirects to the dashboard.
 */
export default function AcceptPage({
  params,
}: {
  params: { token: string };
}) {
  const accept = useMutation(api.invitations.accept);
  const router = useRouter();

  useEffect(() => {
    accept({ token: params.token })
      .then(() => {
        toast.success("Welcome! You've joined the organisation.");
        router.replace("/dashboard");
      })
      .catch((err: Error) => {
        toast.error(err.message ?? "Failed to accept invitation");
        router.replace("/sign-in");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">Joining organisation…</p>
    </div>
  );
}
