"use client";

import { AppSidebar } from "@/components/nav/app-sidebar";
import { OrgProvider, useActiveOrg } from "@/providers/org-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

function ZeroOrgNotice() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-semibold text-lg">
        You&apos;re not in an organisation yet
      </p>
      <p className="max-w-sm text-muted-foreground text-sm">
        Check your invitation link — once you accept an invitation you&apos;ll
        see the app here.
      </p>
    </div>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { active } = useActiveOrg();

  // An invited user who signed up before accepting has zero orgs — don't
  // render the app shell (every page would fire queries that throw).
  if (active === null) {
    return <ZeroOrgNotice />;
  }

  return (
    <>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <SidebarProvider>
        <DashboardShell>{children}</DashboardShell>
      </SidebarProvider>
    </OrgProvider>
  );
}
