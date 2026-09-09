"use client";

import { Alert, Badge, Button, Group, Skeleton, Stack, Text } from "@mantine/core";
import { IconAdjustments, IconBuilding, IconDatabase, IconFileText, IconGitBranch, IconHeartbeat, IconLock, IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "../_i18n/provider";
import { useOrganization } from "../organization-context";
import { WorkspaceHeader } from "../workspace-components";
import { ApplicationSettings } from "./application-settings";
import { OrganizationSettings } from "./organization-settings";
import { applicationSections, resolveSettingsSection, type SettingsSection } from "./settings-catalog";
import classes from "./settings.module.css";

const icons = { general: IconBuilding, ontology: IconGitBranch, ai: IconSparkles, document: IconFileText, auth: IconLock, storage: IconDatabase, observability: IconHeartbeat };

export function SettingsWorkspace({ isAdmin }: { readonly isAdmin: boolean }) {
  const t = useT();
  const { access, accessStatus, organizationSlug, reloadAccess } = useOrganization();
  const router = useRouter();
  const parameters = useSearchParams();
  const requestedSection = parameters.get("section");
  const [applicationDirty, setApplicationDirty] = useState(0);
  const [organizationDirty, setOrganizationDirty] = useState(0);
  const canManageOrganization = access?.role === "owner" || access?.role === "admin";
  const section = resolveSettingsSection(requestedSection, isAdmin, canManageOrganization);
  const applicationActive = applicationSections.some((value) => value === section);
  const dirty = applicationDirty + organizationDirty;
  useEffect(() => {
    if (!dirty) { return; }
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) { return; }
      const target = new URL(anchor.href);
      if (target.origin === location.origin && target.pathname === location.pathname) { return; }
      if (!window.confirm(t("settings.ux.leave"))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", navigate, true); };
  }, [dirty, t]);

  const navigation = (items: readonly SettingsSection[]) => items.map((key) => {
    const Icon = icons[key];
    return <button key={key} type="button" className={classes.navItem} aria-current={section === key ? "page" : undefined} onClick={() => router.replace(`/settings?section=${key}`, { scroll: true })}>
      <Icon size={18} stroke={1.6} /><span>{t(`settings.ux.nav.${key}`)}</span>
    </button>;
  });
  return <Stack gap="xl" className={classes.workspace}>
    <WorkspaceHeader title={t("settings.ux.title")} description={t("settings.ux.lede")} actions={<Badge variant="light" color="gray" leftSection={<IconAdjustments size={13} />}>{t(isAdmin ? "settings.ux.admin" : "settings.ux.organizationAdmin")}</Badge>} />
    {!isAdmin && (accessStatus === "loading" || accessStatus === "idle") && organizationSlug ? <Skeleton height={300} radius="lg" /> : null}
    {!isAdmin && accessStatus === "error" ? <Alert color="red">{t("organization.loadFailed")} <Button variant="light" onClick={reloadAccess}>{t("settings.ux.retry")}</Button></Alert> : null}
    {!isAdmin && !canManageOrganization && (accessStatus === "ready" || !organizationSlug) ? <Alert color="gray">{t("members.accessDenied")}</Alert> : null}
    {isAdmin || canManageOrganization ? <div className={classes.layout}>
      <nav className={classes.navigation} aria-label={t("settings.ux.navigation")}>
        {canManageOrganization ? <><Group justify="space-between" className={classes.navHeading}><Text size="xs" fw={700}>{t("settings.ux.organization")}</Text>{organizationDirty > 0 ? <Badge size="xs">{organizationDirty}</Badge> : null}</Group>{navigation(["general", "ontology"])}</> : null}
        {isAdmin ? <><Group justify="space-between" className={classes.navHeading}><Text size="xs" fw={700}>{t("settings.ux.application")}</Text>{applicationDirty > 0 ? <Badge size="xs">{applicationDirty}</Badge> : null}</Group>{navigation(applicationSections)}</> : null}
        <Text size="xs" c="dimmed" className={classes.navNote}>{t("settings.ux.scopeNote")}</Text>
      </nav>
      <div className={classes.content}>
        {canManageOrganization ? <div hidden={applicationActive}><OrganizationSettings section={section === "ontology" ? "ontology" : "general"} onDirtyChange={setOrganizationDirty} /></div> : null}
        {isAdmin ? <div hidden={!applicationActive}><ApplicationSettings isAdmin section={applicationActive ? section as typeof applicationSections[number] : "ai"} onDirtyChange={setApplicationDirty} /></div> : null}
      </div>
    </div> : null}
  </Stack>;
}
