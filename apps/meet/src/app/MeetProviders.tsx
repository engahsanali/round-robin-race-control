import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { OrganisationRole, OrganisationSummary } from "../data/meetRepository";
import { MeetStoreProvider } from "../state/MeetStore";

export type OrganisationContextValue = {
  organisations: readonly OrganisationSummary[];
  selected: OrganisationSummary | null;
  role: OrganisationRole | null;
};

const OrganisationContext = createContext<OrganisationContextValue | null>(null);

export function MeetProviders({
  children,
  organisations = [],
  selected = null,
}: {
  children: ReactNode;
  organisations?: readonly OrganisationSummary[];
  selected?: OrganisationSummary | null;
}) {
  const value = useMemo(() => ({ organisations, selected, role: selected?.role ?? null }), [organisations, selected]);
  return (
    <OrganisationContext.Provider value={value}>
      <MeetStoreProvider>{children}</MeetStoreProvider>
    </OrganisationContext.Provider>
  );
}

export function useOrganisation(): OrganisationContextValue {
  const value = useContext(OrganisationContext);
  if (!value) throw new Error("useOrganisation must be used inside MeetProviders");
  return value;
}
