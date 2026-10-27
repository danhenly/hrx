"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface RejectDialogProps {
  open: boolean;
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * One reason, copied to every selected day by `rejectDays`. Built on
 * AlertDialog because the repo has no plain Dialog primitive.
 */
export function RejectDialog({
  open,
  count,
  pending,
  onCancel,
  onConfirm,
}: RejectDialogProps) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  function close() {
    setReason("");
    onCancel();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Reject {count} {count === 1 ? "entry" : "entries"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The reason is copied to every selected entry, so the employee sees
            the same note on each day.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What needs fixing?"
          aria-label="Rejection reason"
          className="min-h-[96px]"
        />

        <AlertDialogFooter>
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || trimmed.length === 0}
            onClick={() => {
              const value = trimmed;
              setReason("");
              onConfirm(value);
            }}
          >
            Reject {count}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
