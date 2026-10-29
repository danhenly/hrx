"use client";

import { Clock, Cog, Users, Wallet } from "lucide-react";
import * as React from "react";
import { Kbd } from "@/components/common/kbd";
import { NavOverview } from "@/components/nav/nav-overview";
import { NavUser } from "@/components/nav/nav-user";
import { SidebarResizer } from "@/components/nav/sidebar-resizer";
import { OrganizationSwitcher } from "@/components/nav/organization-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SIDEBAR_KEYBOARD_SHORTCUT = "[";

const data = {
  overview: [
    {
      name: "Time",
      url: "/dashboard/time",
      icon: Clock,
    },
    {
      name: "Employees",
      url: "/dashboard/employees",
      icon: Users,
    },
    {
      name: "Payroll",
      url: "/dashboard/payroll",
      icon: Wallet,
    },
    {
      name: "Settings",
      url: "/dashboard/settings/general",
      icon: Cog,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="flex h-14 justify-center border-b py-1">
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavOverview items={data.overview} />
      </SidebarContent>
      <SidebarFooter className="border-t">
        <NavUser />
      </SidebarFooter>
      <SidebarResizer />
      <SidebarRail />
    </Sidebar>
  );
}

export function AppSidebarTrigger() {
  const { toggleSidebar } = useSidebar();

  // Adds a keyboard shortcut to toggle the sidebar
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger />
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="mr-px inline-flex items-center gap-1">
            Toggle Sidebar{" "}
            <Kbd className="border-muted-foreground bg-primary text-background">
              ⌘+{SIDEBAR_KEYBOARD_SHORTCUT}
            </Kbd>
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
