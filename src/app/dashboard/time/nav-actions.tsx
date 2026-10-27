"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function NavActions() {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button size="sm" className="gap-2" asChild>
        <Link href="/dashboard/time/entries">
          <Plus className="h-4 w-4" />
          Log time
        </Link>
      </Button>
    </div>
  );
}
