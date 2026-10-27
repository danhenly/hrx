"use client";

import { ChevronLeft, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

export function NavActions() {
  const pathname = usePathname();
  const onEntries = pathname?.startsWith("/dashboard/time/entries") ?? false;

  return (
    <div className="flex items-center gap-2 text-sm">
      {onEntries ? (
        <Button size="sm" variant="outline" className="gap-2" asChild>
          <Link href="/dashboard/time">
            <ChevronLeft className="h-4 w-4" />
            Timesheets
          </Link>
        </Button>
      ) : (
        <Button size="sm" className="gap-2" asChild>
          <Link href="/dashboard/time/entries">
            <Plus className="h-4 w-4" />
            Log time
          </Link>
        </Button>
      )}
    </div>
  );
}
