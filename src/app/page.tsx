import {
  Badge,
  Box,
  Button,
  Container,
  Group,
  Image,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title
} from "@mantine/core";
import {
  IconBinaryTree,
  IconBook2,
  IconBrain,
  IconFileSearch,
  IconShieldLock
} from "@tabler/icons-react";
import { headers } from "next/headers";

import { canAccessScopedResource } from "@/domain/identity/organization-access";
import {
  getOrganizationAccess,
  listOrganizationMemberships
} from "@/lib/organization-service";
import {
  listOrganizationMemberRecords,
  listTeamRecords
} from "@/lib/organization-administration-service";
import { getSessionUser } from "@/lib/session";

import { LoginPanel } from "./login-panel";
import classes from "./page.module.css";
import { ThemeToggle } from "./theme-toggle";
import { Workspace } from "./workspace";

export const dynamic = "force-dynamic";

const capabilities = [
  {
    icon: IconBrain,
    title: "Long-term Memory",
    description: "규칙, 결정, 경험을 revision과 유효기간까지 보존한다."
  },
  {
    icon: IconFileSearch,
    title: "Hybrid RAG",
    description: "문서를 수집하고 Full-Text Search와 vector ranking을 결합한다."
  },
  {
    icon: IconBinaryTree,
    title: "Knowledge Graph",
    description: "엔터티 관계를 탐색하고 원본 memory와 chunk를 역참조한다."
  },
  {
    icon: IconShieldLock,
    title: "Scoped Access",
    description: "조직, 팀, 사용자 경계를 모든 검색과 mutation에 적용한다."
  }
] as const;

export default async function Home() {
  const requestHeaders = await headers();
  const user = await getSessionUser(new Headers(requestHeaders));
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin =
    process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
    (host ? `${protocol}://${host}` : "");
  const organizations = user
    ? await listOrganizationMemberships(user.id)
    : [];
  const organizationEntries = user
    ? await Promise.all(
        organizations.map(async (organization) => {
          const access = await getOrganizationAccess(organization.id, user.id);
          if (!access) {
            throw new Error("organization membership disappeared during render");
          }
          const canManageOrganization =
            access.role === "admin" || access.role === "owner";
          const [members, teams] = await Promise.all([
            canManageOrganization
              ? listOrganizationMemberRecords(access)
              : Promise.resolve([]),
            listTeamRecords(access)
          ]);
          return {
            administration: canManageOrganization
              ? {
                members: members.map((member) => ({
                  userId: member.userId,
                  email: member.email,
                  name: member.name,
                  role: member.role
                })),
                teams: teams.map((team) => ({
                  id: team.id,
                  slug: team.slug,
                  name: team.name
                }))
              }
              : undefined,
            organizationId: organization.id,
            writableTeams: teams
              .filter((team) =>
                canAccessScopedResource(access, "write", {
                  kind: "team",
                  organizationId: organization.id,
                  teamId: team.id
                })
              )
              .map((team) => ({ id: team.id, name: team.name, slug: team.slug }))
          };
        })
      )
    : [];
  const administrationByOrganization = Object.fromEntries(
    organizationEntries.flatMap((entry) =>
      entry.administration
        ? [[entry.organizationId, entry.administration] as const]
        : []
    )
  );
  const writableTeamsByOrganization = Object.fromEntries(
    organizationEntries.map((entry) => [entry.organizationId, entry.writableTeams])
  );

  return (
    <Box className={classes.page}>
      <Container className={classes.shell} size="xl">
        <Group className={classes.header} justify="space-between">
          <Group gap="sm">
            <Image
              alt="Agent Memory logo"
              className={classes.brandLogo}
              src="/logo.png"
            />
            <Text fw={700} size="lg">
              Agent Memory
            </Text>
            <Badge color="teal" variant="light">
              Self-hosted
            </Badge>
          </Group>
          <Group gap="xs">
            <Button
              component="a"
              href="/guide"
              leftSection={<IconBook2 size={16} />}
              variant="subtle"
            >
              Guide
            </Button>
            <ThemeToggle />
          </Group>
        </Group>

        {user ? (
          <Workspace
            administrationByOrganization={administrationByOrganization}
            origin={origin}
            organizations={organizations}
            user={user}
            writableTeamsByOrganization={writableTeamsByOrganization}
          />
        ) : (
          <main className={classes.hero}>
            <Stack className={classes.intro} gap="xl">
              <Badge className={classes.eyebrow} size="lg" variant="light">
                Shared context infrastructure for AI agents
              </Badge>
              <Stack gap="md">
                <Title className={classes.title} order={1}>
                  에이전트가 기억하고,
                  <br />조직은 통제합니다.
                </Title>
                <Text className={classes.lead} c="dimmed" size="xl">
                  AI Agent의 장기 기억, RAG, Knowledge Graph를 하나의 권한
                  모델과 MCP endpoint로 독립 운영합니다. 필요하면 Agent
                  Studio와 연동할 수 있습니다.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {capabilities.map((capability) => (
                  <Group
                    align="flex-start"
                    className={classes.capability}
                    key={capability.title}
                    wrap="nowrap"
                  >
                    <ThemeIcon color="indigo" variant="light">
                      <capability.icon size={18} stroke={1.7} />
                    </ThemeIcon>
                    <Stack gap={2}>
                      <Text fw={650}>{capability.title}</Text>
                      <Text c="dimmed" size="sm">
                        {capability.description}
                      </Text>
                    </Stack>
                  </Group>
                ))}
              </SimpleGrid>
            </Stack>

            <LoginPanel
              googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)}
              oidcEnabled={Boolean(process.env.OIDC_ISSUER)}
              passwordEnabled={process.env.AUTH_PASSWORD === "true"}
              signUpEnabled={process.env.AUTH_PASSWORD_SIGNUP === "true"}
            />
          </main>
        )}
      </Container>
    </Box>
  );
}
