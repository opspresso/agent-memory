"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { OrganizationMembership } from "@/domain/identity/organization-access-repository";

const ACTIVE_ORGANIZATION_STORAGE_KEY = "agent-memory-active-organization";

interface OrganizationContextValue {
  readonly organizations: readonly OrganizationMembership[];
  readonly activeOrganizations: readonly OrganizationMembership[];
  readonly activeOrganization: OrganizationMembership | undefined;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly access: OrganizationAccess | undefined;
  readonly selectOrganization: (organizationId: string) => void;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(
  null
);

function subscribeToStorage(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function readStoredOrganizationId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function OrganizationProvider({
  children,
  organizations
}: {
  readonly children: ReactNode;
  readonly organizations: readonly OrganizationMembership[];
}) {
  const activeOrganizations = useMemo(
    () =>
      organizations.filter((organization) => organization.status === "active"),
    [organizations]
  );
  const [selectedId, setSelectedId] = useState<string>();
  const storedId = useSyncExternalStore(
    subscribeToStorage,
    readStoredOrganizationId,
    () => null
  );
  const organizationId =
    [selectedId, storedId, activeOrganizations[0]?.id].find(
      (candidate) =>
        candidate &&
        activeOrganizations.some(
          (organization) => organization.id === candidate
        )
    ) ?? "";
  const organizationSlug =
    activeOrganizations.find(
      (organization) => organization.id === organizationId
    )?.slug ?? "";
  const [accessState, setAccessState] = useState<{
    readonly organizationId: string;
    readonly value: OrganizationAccess;
  }>();

  useEffect(() => {
    if (!organizationId || !organizationSlug) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/organizations/${organizationSlug}/me`, {
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as {
          organizationId: string;
          role: OrganizationAccess["role"];
          teams: OrganizationAccess["teams"];
          user: { id: string };
        };
        setAccessState({
          organizationId: body.organizationId,
          value: {
            organizationId: body.organizationId,
            userId: body.user.id,
            role: body.role,
            teams: body.teams
          }
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [organizationId, organizationSlug]);

  const access =
    accessState?.organizationId === organizationId
      ? accessState.value
      : undefined;

  const selectOrganization = useCallback(
    (nextOrganizationId: string) => {
      if (
        !activeOrganizations.some(
          (organization) => organization.id === nextOrganizationId
        )
      ) {
        return;
      }
      setSelectedId(nextOrganizationId);
      try {
        window.localStorage.setItem(
          ACTIVE_ORGANIZATION_STORAGE_KEY,
          nextOrganizationId
        );
      } catch {
        // per-browser convenience only
      }
    },
    [activeOrganizations]
  );

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      activeOrganizations,
      activeOrganization: activeOrganizations.find(
        (organization) => organization.id === organizationId
      ),
      organizationId,
      organizationSlug,
      access,
      selectOrganization
    }),
    [
      access,
      activeOrganizations,
      organizationId,
      organizationSlug,
      organizations,
      selectOrganization
    ]
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganization requires OrganizationProvider");
  }
  return context;
}
