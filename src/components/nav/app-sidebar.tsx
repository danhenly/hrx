"use client";

import { Clock, Cog, Users } from "lucide-react";
import * as React from "react";
import { Kbd } from "@/components/common/kbd";
import { NavOverview } from "@/components/nav/nav-overview";
import { NavUser } from "@/components/nav/nav-user";
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

// TODO: replace with the signed-in user's organizations (api.organizations.getMyOrg).
// The template's slug/plan fields do not exist in the Convex schema.
const data = {
  orgs: [
    {
      name: "OpenStatus",
      slug: "easy-peasy",
      plan: "Hobby",
    },
    {
      name: "Acme Corp.",
      slug: "acme-corp",
      plan: "Starter",
    },
  ],
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
        <OrganizationSwitcher orgs={data.orgs} />
      </SidebarHeader>
      <SidebarContent>
        <NavOverview items={data.overview} />
      </SidebarContent>
      <SidebarFooter className="border-t">
        <NavUser />
      </SidebarFooter>
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
