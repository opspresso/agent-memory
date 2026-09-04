"use client";

import {
  Alert,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Button,
  Group,
  Image,
  Menu,
  ScrollArea,
  Select,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBook2,
  IconChartBar,
  IconCloudUpload,
  IconLogout,
  IconPlugConnected,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconUsers,
  IconUsersGroup,
  IconUsersPlus
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { signOut } from "@/lib/auth-client";
import type { SessionUser } from "@/lib/session";

import { useT } from "./_i18n/provider";
import type { MessageKey } from "./_i18n/messages/en";
import classes from "./app-shell.module.css";
import { LocaleToggle } from "./locale-toggle";
import { useOrganization } from "./organization-context";
import { ThemeToggle } from "./theme-toggle";

const NAV_GROUPS = [
  {
    key: "workspace",
    label: "nav.group.workspace",
    items: [
      { href: "/", label: "nav.search", Icon: IconSearch },
      { href: "/documents", label: "nav.documents", Icon: IconCloudUpload },
      { href: "/review", label: "nav.review", Icon: IconShieldCheck },
      { href: "/connect", label: "nav.connect", Icon: IconPlugConnected }
    ]
  },
  {
    key: "administration",
    label: "nav.group.administration",
    items: [
      { href: "/members", label: "nav.members", Icon: IconUsers },
      { href: "/teams", label: "nav.teams", Icon: IconUsersGroup },
      { href: "/settings", label: "nav.settings", Icon: IconSettings }
    ]
  }
] as const satisfies ReadonlyArray<NavGroup>;

interface NavItem {
  readonly href: string;
  readonly label: MessageKey;
  readonly Icon: typeof IconChartBar;
}

interface NavGroup {
  readonly key: string;
  readonly label: MessageKey;
  readonly items: ReadonlyArray<NavItem>;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShellFrame({
  children,
  user,
  version
}: {
  readonly children: ReactNode;
  readonly user: SessionUser | null;
  readonly version: string;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [opened, { toggle, close }] = useDisclosure(false);
  const [signOutError, setSignOutError] = useState<string>();
  const {
    activeOrganization,
    activeOrganizations,
    organizationId,
    access,
    accessStatus,
    reloadAccess,
    selectOrganization
  } = useOrganization();

  const showNav = user !== null && activeOrganizations.length > 0;
  const canManageOrganization =
    access?.role === "admin" || access?.role === "owner";
  const managesAnyTeam =
    canManageOrganization ||
    Boolean(access?.teams.some((team) => team.role === "manager"));
  const visibleGroups = NAV_GROUPS.flatMap(
    (group): readonly NavGroup[] => {
      if (group.key !== "administration") {
        return [group];
      }
      const items = group.items.filter((item) =>
        item.href === "/teams" ? managesAnyTeam : canManageOrganization
      );
      return items.length > 0
        ? [{ key: group.key, label: group.label, items }]
        : [];
    }
  );

  async function handleSignOut() {
    setSignOutError(undefined);
    try {
      const result = await signOut();
      if (result.error) {
        setSignOutError(t("workspace.signOutFailed"));
        return;
      }
      router.refresh();
    } catch {
      setSignOutError(t("workspace.signOutFailed"));
    }
  }

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{
        width: 248,
        breakpoint: "md",
        collapsed: { mobile: !opened || !showNav, desktop: !showNav }
      }}
      padding={0}
    >
      <AppShell.Header className={classes.header}>
        <Group gap="md" h="100%" px={{ base: "md", md: "lg" }} wrap="nowrap">
          {showNav ? (
            <Burger
              aria-label={t("shell.toggleNavigation")}
              hiddenFrom="md"
              onClick={toggle}
              opened={opened}
              size="sm"
            />
          ) : null}
          <UnstyledButton component={Link} href="/">
            <Group gap="sm" wrap="nowrap">
              <span className={classes.logoWrap}>
                <Image alt="Agent Memory logo" h={26} src="/logo.png" w={26} />
              </span>
              <Stack gap={0}>
                <Text fw={650} fz="md" lh={1.1}>
                  Agent Memory
                </Text>
                <Text c="dimmed" fz={10} lts="0.12em" tt="uppercase" visibleFrom="xs">
                  {t("home.badge")}
                </Text>
              </Stack>
            </Group>
          </UnstyledButton>
          {showNav && activeOrganizations.length > 0 ? (
            <Select
              allowDeselect={false}
              aria-label={t("workspace.activeOrganization")}
              data={activeOrganizations.map((organization) => ({
                value: organization.id,
                label: organization.name
              }))}
              onChange={(value) => {
                if (value) {
                  selectOrganization(value);
                }
              }}
              size="xs"
              value={organizationId}
              visibleFrom="sm"
              w={200}
            />
          ) : null}
          <Group gap="xs" ml="auto" wrap="nowrap">
            {!showNav ? (
              <Button
                component={Link}
                href="/guide"
                leftSection={<IconBook2 size={16} />}
                variant="subtle"
              >
                {t("nav.guide")}
              </Button>
            ) : null}
            <LocaleToggle />
            <ThemeToggle />
            {user ? (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <UnstyledButton aria-label={t("shell.userMenu")}>
                    <Avatar
                      color="brand"
                      name={user.name}
                      radius="xl"
                      size={32}
                      src={user.image}
                    />
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label style={{ wordBreak: "break-all" }}>
                    {user.name} · {user.email}
                  </Menu.Label>
                  {activeOrganization ? (
                    <Menu.Label>
                      <Group gap={6}>
                        <Badge variant="light">{activeOrganization.slug}</Badge>
                        <Badge color="gray" variant="outline">
                          {activeOrganization.role}
                        </Badge>
                      </Group>
                    </Menu.Label>
                  ) : null}
                  {activeOrganizations.length > 0 ? (
                    <Menu.Item
                      component={Link}
                      href="/onboarding"
                      leftSection={<IconUsersPlus size={15} />}
                    >
                      {t("shell.joinOrganization")}
                    </Menu.Item>
                  ) : null}
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconLogout size={15} />}
                    onClick={() => void handleSignOut()}
                  >
                    {t("workspace.signOut")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : null}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navbar}>
        {showNav ? (
          <>
            <Select
              allowDeselect={false}
              aria-label={t("workspace.activeOrganization")}
              data={activeOrganizations.map((organization) => ({
                value: organization.id,
                label: organization.name
              }))}
              hiddenFrom="sm"
              onChange={(value) => {
                if (value) {
                  selectOrganization(value);
                }
              }}
              size="xs"
              value={organizationId}
            />
            <ScrollArea scrollbarSize={4} style={{ flex: 1 }}>
              <Stack gap="xl">
                {visibleGroups.map((group) => (
                  <Stack gap={6} key={group.key}>
                    <Text className={classes.navGroupLabel} component="span">
                      {t(group.label)}
                    </Text>
                    {group.items.map((item) => {
                      const active = isActive(pathname, item.href);
                      return (
                        <UnstyledButton
                          aria-current={active ? "page" : undefined}
                          className={classes.navLink}
                          component={Link}
                          data-active={active || undefined}
                          href={item.href}
                          key={item.href}
                          onClick={close}
                        >
                          <ThemeIcon
                            color="brand"
                            size="md"
                            variant={active ? "light" : "transparent"}
                          >
                            <item.Icon size={17} stroke={1.8} />
                          </ThemeIcon>
                          <Text fw={active ? 600 : 450} fz="sm">
                            {t(item.label)}
                          </Text>
                        </UnstyledButton>
                      );
                    })}
                  </Stack>
                ))}
              </Stack>
            </ScrollArea>
            <Stack className={classes.navFooter} gap={6}>
              <UnstyledButton
                className={classes.navLink}
                component={Link}
                href="/guide"
                onClick={close}
              >
                <ThemeIcon color="brand" size="md" variant="transparent">
                  <IconBook2 size={17} stroke={1.8} />
                </ThemeIcon>
                <Text fw={450} fz="sm">
                  {t("nav.guide")}
                </Text>
              </UnstyledButton>
              <Text c="dimmed" fz="xs" px="xs">
                Agent Memory v{version}
              </Text>
            </Stack>
          </>
        ) : null}
      </AppShell.Navbar>

      <AppShell.Main>
        <main className={classes.main} id="main-content">
          {signOutError ? (
            <Alert
              color="red"
              m={{ base: "md", md: "lg" }}
              onClose={() => setSignOutError(undefined)}
              withCloseButton
            >
              {signOutError}
            </Alert>
          ) : null}
          {accessStatus === "error" ? (
            <Alert
              color="red"
              m={{ base: "md", md: "lg" }}
              title={t("organization.loadFailed")}
            >
              <Button onClick={reloadAccess} size="xs" variant="light">
                {t("organization.refresh")}
              </Button>
            </Alert>
          ) : null}
          {children}
        </main>
      </AppShell.Main>
    </AppShell>
  );
}
