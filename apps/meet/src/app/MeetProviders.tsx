import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { OrganisationRole, OrganisationSummary } from "../data/meetRepository";
import { createInitialMeetStoreState, MeetStoreProvider, type WorkspaceMode } from "../state/MeetStore";

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
  workspace = "official",
}: {
  children: ReactNode;
  organisations?: readonly OrganisationSummary[];
  selected?: OrganisationSummary | null;
  workspace?: WorkspaceMode;
}) {
  const value = useMemo(() => ({ organisations, selected, role: selected?.role ?? null }), [organisations, selected]);
  const storeState = useMemo(() => createInitialMeetStoreState({ workspace, organisationId: selected?.id ?? null, role: selected?.role ?? null }), [workspace, selected?.id, selected?.role]);
  return (
    <OrganisationContext.Provider value={value}>
      <MeetStoreProvider key={`${workspace}:${selected?.id ?? "none"}:${selected?.role ?? "none"}`} initialState={storeState}>{children}</MeetStoreProvider>
    </OrganisationContext.Provider>
  );
}

export function useOrganisation(): OrganisationContextValue {
  const value = useContext(OrganisationContext);
  if (!value) throw new Error("useOrganisation must be used inside MeetProviders");
  return value;
}
