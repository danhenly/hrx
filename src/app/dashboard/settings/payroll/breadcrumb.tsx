"use client";

import { Briefcase, Cog, User, Wallet } from "lucide-react";
import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";

export function Breadcrumb() {
  return (
    <NavBreadcrumb
      items={[
        { type: "page", label: "Settings" },
        {
          type: "select",
          items: [
            { value: "general", label: "General", icon: Cog },
            { value: "account", label: "Account", icon: User },
            { value: "positions", label: "Positions", icon: Briefcase },
            { value: "payroll", label: "Payroll", icon: Wallet },
          ],
        },
      ]}
    />
  );
}
