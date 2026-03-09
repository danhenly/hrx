import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { FormCardGroup } from "@/components/forms/form-card";
import { FormOrganization } from "@/components/forms/settings/form-organization";
import { FormTeam } from "@/components/forms/settings/form-team";

export default function Page() {
  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>General</SectionTitle>
          <SectionDescription>
            Manage your organization settings and team members.
          </SectionDescription>
        </SectionHeader>
        <FormCardGroup>
          <FormOrganization />
          <FormTeam />
        </FormCardGroup>
      </Section>
    </SectionGroup>
  );
}
