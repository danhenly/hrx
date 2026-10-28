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

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** Reject and unlock require a reason; a delete confirmation does not. */
  requireReason?: boolean;
  destructive?: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * One dialog for reject / unlock / delete. Built on AlertDialog because the repo
 * has no plain Dialog primitive, and controlled so the page decides what the
 * reason does (copied to every selected day, or ignored).
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  requireReason = true,
  destructive = false,
  pending,
  onCancel,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const blocked = pending || (requireReason && trimmed.length === 0);

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
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {requireReason ? (
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (required)"
            aria-label="Reason"
            className="min-h-[96px]"
          />
        ) : null}

        <AlertDialogFooter>
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={blocked}
            onClick={() => {
              const value = requireReason ? trimmed : "";
              setReason("");
              onConfirm(value);
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
