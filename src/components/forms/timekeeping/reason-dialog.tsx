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

/**
 * Three explicit dialogs, not one dialog with mode booleans: each flow owns its
 * copy, whether a reason is required, and how it reads in the record. The frames
 * below hold the shared AlertDialog plumbing.
 */

interface ReasonDialogFrameProps {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

function ReasonDialogFrame({
  title,
  description,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: ReasonDialogFrameProps) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  function close() {
    setReason("");
    onCancel();
  }

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (required)"
          aria-label="Reason"
          className="min-h-[96px]"
        />

        <AlertDialogFooter>
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || trimmed.length === 0}
            onClick={() => {
              setReason("");
              onConfirm(trimmed);
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface DeleteDialogProps {
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeleteDialogFrame({
  count,
  pending,
  onCancel,
  onConfirm,
}: DeleteDialogProps) {
  const noun = count === 1 ? "entry" : "entries";

  return (
    <AlertDialog open onOpenChange={(next) => (next ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {count} {noun}
          </AlertDialogTitle>
          <AlertDialogDescription>
            A rejected entry is removed permanently. The deletion is audited.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface DaysDialogProps {
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function RejectDaysDialog({ count, ...props }: DaysDialogProps) {
  const noun = count === 1 ? "entry" : "entries";
  return (
    <ReasonDialogFrame
      {...props}
      title={`Reject ${count} ${noun}`}
      description="The reason is copied to every selected entry, so the employee sees the same note on each day."
      confirmLabel={`Reject ${count}`}
    />
  );
}

export function UnlockDaysDialog({ count, ...props }: DaysDialogProps) {
  const noun = count === 1 ? "entry" : "entries";
  return (
    <ReasonDialogFrame
      {...props}
      title={`Unlock ${count} ${noun}`}
      description="The day returns to the employee as rejected so it can be corrected and resubmitted. The lock and this reason stay on the record."
      confirmLabel={`Unlock ${count}`}
    />
  );
}

export function DeleteEntryDialog(props: DeleteDialogProps) {
  return <DeleteDialogFrame {...props} />;
}
