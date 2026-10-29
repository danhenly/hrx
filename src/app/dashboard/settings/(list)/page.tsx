import { Link } from "@/components/common/link";
import {
  ActionCard,
  ActionCardDescription,
  ActionCardGroup,
  ActionCardHeader,
  ActionCardTitle,
} from "@/components/content/action-card";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";

const settings = [
  {
    title: "General",
    description: "Manage your workspace settings.",
    href: "/dashboard/settings/general",
  },
  {
    title: "Account",
    description: "Manage your account information.",
    href: "/dashboard/settings/account",
  },
  {
    title: "Positions",
    description: "Maintain the job-title masterlist used by employee records.",
    href: "/dashboard/settings/positions",
  },
  {
    title: "Payroll",
    description:
      "Statutory tables with effective dates, and the org's payroll conventions.",
    href: "/dashboard/settings/payroll",
  },
  {
    title: "Audit log",
    description: "View the trail of membership and approval changes.",
    href: "/dashboard/settings/audit",
  },
];
export default function Page() {
  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>Settings</SectionTitle>
          <SectionDescription>
            All your settings in one place.
          </SectionDescription>
        </SectionHeader>
        <ActionCardGroup>
          {settings.map((setting) => (
            <Link href={setting.href} key={setting.href}>
              <ActionCard className="h-full w-full">
                <ActionCardHeader>
                  <ActionCardTitle>{setting.title}</ActionCardTitle>
                  <ActionCardDescription>
                    {setting.description}
                  </ActionCardDescription>
                </ActionCardHeader>
              </ActionCard>
            </Link>
          ))}
        </ActionCardGroup>
      </Section>
    </SectionGroup>
  );
}
