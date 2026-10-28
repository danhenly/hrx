"use client";

import { useConvex, useMutation } from "convex/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Statutory table editor (D17).
 *
 * A schedule is entered BEFORE it applies: set `effectiveFrom` in the future, paste
 * the published values, check the diff against the table in force, save. The engine
 * picks it up from that date with no deploy.
 *
 * The payload is edited as JSON. That is deliberate for P0 — one editor that works
 * for six different published shapes, with the server doing the validation that
 * matters (no overlapping ranges, a source on every row, contiguous tax brackets).
 * Per-kind forms are a later refinement, not a correctness question.
 */

export type StatutoryRowDraft = {
  kind: "sss" | "philhealth" | "pagibig" | "tax" | "deminimis" | "holiday";
  effectiveFrom: string;
  effectiveTo?: string;
  payload: unknown;
  source: string;
};

export function FormStatutoryTable({
  orgId,
  draft,
  onDone,
}: {
  orgId: Id<"organizations">;
  draft: StatutoryRowDraft;
  onDone: () => void;
}) {
  const convex = useConvex();
  const upsert = useMutation(api.payroll.statutoryTables.upsert);
  const [isPending, startTransition] = useTransition();

  const [effectiveFrom, setEffectiveFrom] = useState(draft.effectiveFrom);
  const [effectiveTo, setEffectiveTo] = useState(draft.effectiveTo ?? "");
  const [source, setSource] = useState(draft.source);
  const [payloadText, setPayloadText] = useState(
    JSON.stringify(draft.payload, null, 2),
  );
  const [diff, setDiff] = useState<{
    previousEffectiveFrom: number | null;
    added: { path: string; after: unknown }[];
    removed: { path: string; before: unknown }[];
    changed: { path: string; before: unknown; after: unknown }[];
  } | null>(null);

  function parsePayload(): unknown | null {
    try {
      return JSON.parse(payloadText);
    } catch (error) {
      toast.error(`Payload is not valid JSON: ${(error as Error).message}`);
      return null;
    }
  }

  async function handlePreview() {
    const payload = parsePayload();
    if (payload === null) return;
    try {
      const result = await convex.query(api.payroll.statutoryTables.previewDiff, {
        orgId,
        kind: draft.kind,
        effectiveFrom,
        payload,
      });
      setDiff({
        previousEffectiveFrom: result.previousEffectiveFrom,
        added: result.diff.added,
        removed: result.diff.removed,
        changed: result.diff.changed,
      });
    } catch (error) {
      toast.error((error as Error).message ?? "Could not build the diff");
    }
  }

  function handleSave() {
    const payload = parsePayload();
    if (payload === null) return;
    startTransition(async () => {
      try {
        const result = await upsert({
          orgId,
          kind: draft.kind,
          effectiveFrom,
          effectiveTo: effectiveTo || undefined,
          payload,
          source,
        });
        const changes =
          result.diff.added.length +
          result.diff.removed.length +
          result.diff.changed.length;
        toast.success(
          `${result.created ? "Added" : "Updated"} the ${draft.kind} table — ${changes} field(s) changed`,
        );
        onDone();
      } catch (error) {
        toast.error((error as Error).message ?? "Failed to save the table");
      }
    });
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input
            id="effectiveFrom"
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="effectiveTo">Effective to (optional)</Label>
          <Input
            id="effectiveTo"
            type="date"
            value={effectiveTo}
            onChange={(event) => setEffectiveTo(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Left blank, this table stays in force until the next one closes it.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="source">Source citation</Label>
        <Input
          id="source"
          placeholder="BIR RR No. 29-2025 — https://…"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Required. A rate nobody can point at is a rate nobody can defend in an
          audit.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payload">Published values (JSON)</Label>
        <Textarea
          id="payload"
          className="min-h-[320px] font-mono text-xs"
          value={payloadText}
          onChange={(event) => {
            setPayloadText(event.target.value);
            setDiff(null);
          }}
          spellCheck={false}
        />
      </div>

      {diff && (
        <div className="space-y-2 rounded-md border p-3 text-xs">
          <div className="font-medium text-sm">
            Diff against the table in force
            {diff.previousEffectiveFrom
              ? ` (from ${new Date(diff.previousEffectiveFrom + 8 * 3600 * 1000)
                  .toISOString()
                  .slice(0, 10)})`
              : " (none — this is the first table of its kind)"}
          </div>
          {diff.added.length === 0 &&
          diff.removed.length === 0 &&
          diff.changed.length === 0 ? (
            <p className="text-muted-foreground">No field changes.</p>
          ) : (
            <div className="space-y-1 font-mono">
              {diff.changed.map((change) => (
                <div key={`changed-${change.path}`}>
                  <span className="text-muted-foreground">{change.path}</span>:{" "}
                  {String(change.before)} → {String(change.after)}
                </div>
              ))}
              {diff.added.map((entry) => (
                <div key={`added-${entry.path}`} className="text-emerald-600">
                  + {entry.path}: {String(entry.after)}
                </div>
              ))}
              {diff.removed.map((entry) => (
                <div key={`removed-${entry.path}`} className="text-destructive">
                  − {entry.path}: {String(entry.before)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handlePreview}>
          Preview diff
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save table"}
        </Button>
      </div>
    </div>
  );
}
