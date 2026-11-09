"use client";

import { useQuery } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

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

  const setActiveOrg = useCallback((orgId: Id<"organizations">) => {
    setStoredId(orgId);
    localStorage.setItem(STORAGE_KEY, orgId);
  }, []);

  const value = useMemo<OrgContextValue>(
    () => ({
      orgs,
      active,
      orgId: active?.orgId,
      role: active?.role,
      setActiveOrg,
    }),
    [orgs, active, setActiveOrg],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useActiveOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useActiveOrg must be used inside OrgProvider");
  return ctx;
}

/**
 * Role-gated UI reads the provider, not a prop: the org context already knows the
 * active membership, so pages do not fetch `users.getMe` just to thread a boolean
 * through every intermediate component.
 */
export function useIsAdmin() {
  const { role } = useActiveOrg();
  return role === "admin";
}
