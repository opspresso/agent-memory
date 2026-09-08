"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { OrganizationMembership } from "@/domain/identity/organization-access-repository";

import { organizationAccessResponseSchema } from "./api-response-schemas";
import { responseJson } from "./http-response";


interface OrganizationContextValue {
  readonly organizations: readonly OrganizationMembership[];
  readonly activeOrganizations: readonly OrganizationMembership[];
  readonly activeOrganization: OrganizationMembership | undefined;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly access: OrganizationAccess | undefined;
  readonly accessStatus: "idle" | "loading" | "ready" | "error";
  readonly reloadAccess: () => void;
}

type OrganizationAccessState =
  | Readonly<{ organizationId: string; status: "loading" | "error" }>
  | Readonly<{
      organizationId: string;
      status: "ready";
      value: OrganizationAccess;
    }>;

const OrganizationContext = createContext<OrganizationContextValue | null>(
  null
);

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
  const organizationId = activeOrganizations[0]?.id ?? "";
  const organizationSlug = activeOrganizations[0]?.slug ?? "";
  const [accessState, setAccessState] = useState<OrganizationAccessState>();
  const [accessRequestVersion, setAccessRequestVersion] = useState(0);

  useEffect(() => {
    if (!organizationId || !organizationSlug) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/me`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const body = await responseJson(
          response,
          "organization access request failed",
          organizationAccessResponseSchema
        );
        if (body.organizationId !== organizationId) {
          throw new Error("organization access response does not match request");
        }
        setAccessState({
          organizationId: body.organizationId,
          status: "ready",
          value: {
            organizationId: body.organizationId,
            userId: body.user.id,
            role: body.role,
            teams: body.teams
          }
        });
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setAccessState({ organizationId, status: "error" });
      });
    return () => controller.abort();
  }, [accessRequestVersion, organizationId, organizationSlug]);

  const access =
    accessState?.organizationId === organizationId &&
    accessState.status === "ready"
      ? accessState.value
      : undefined;
  const accessStatus =
    !organizationId || !organizationSlug
      ? "idle"
      : accessState?.organizationId === organizationId
        ? accessState.status
        : "loading";

  const reloadAccess = useCallback(() => {
    if (organizationId) {
      setAccessState({ organizationId, status: "loading" });
    }
    setAccessRequestVersion((current) => current + 1);
  }, [organizationId]);

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
      accessStatus,
      reloadAccess
    }),
    [
      access,
      accessStatus,
      activeOrganizations,
      organizationId,
      organizationSlug,
      organizations,
      reloadAccess
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
