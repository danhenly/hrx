"use client";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "hrx.activeOrgId";

type OrgRow = {
  orgId: Id<"organizations">;
  name: string;
  role: "admin" | "hr";
  membershipId: Id<"members">;
};

type OrgContextValue = {
  orgs: OrgRow[] | undefined;
  /** undefined = loading, null = no orgs */
  active: OrgRow | null | undefined;
  orgId: Id<"organizations"> | undefined;
  role: "admin" | "hr" | undefined;
  setActiveOrg: (orgId: Id<"organizations">) => void;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const orgs = useQuery(api.organizations.listMyOrgs);
  const [storedId, setStoredId] = useState<string | null>(null);

  // localStorage only after mount — avoids SSR hydration mismatch.
  useEffect(() => {
    setStoredId(localStorage.getItem(STORAGE_KEY));
  }, []);

  const active = useMemo(() => {
    if (orgs === undefined) return undefined;
    return orgs.find((o) => o.orgId === storedId) ?? orgs[0] ?? null;
  }, [orgs, storedId]);

  const setActiveOrg = (orgId: Id<"organizations">) => {
    setStoredId(orgId);
    localStorage.setItem(STORAGE_KEY, orgId);
  };

  return (
    <OrgContext.Provider
      value={{
        orgs,
        active,
        orgId: active?.orgId,
        role: active?.role,
        setActiveOrg,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useActiveOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useActiveOrg must be used inside OrgProvider");
  return ctx;
}
