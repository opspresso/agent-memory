import {
  Badge,
  Box,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title
} from "@mantine/core";
import {
  IconBinaryTree,
  IconBrain,
  IconFileSearch,
  IconShieldLock
} from "@tabler/icons-react";
import { headers } from "next/headers";

import { listOrganizationMemberships } from "@/lib/organization-service";
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
  const user = await getSessionUser(new Headers(await headers()));
  const organizations = user
    ? await listOrganizationMemberships(user.id)
    : [];
  const administrationEntries = user
    ? await Promise.all(
        organizations
          .filter(
            (organization) =>
              organization.role === "admin" || organization.role === "owner"
          )
          .map(async (organization) => {
            const access = {
              organizationId: organization.id,
              userId: user.id,
              role: organization.role,
              teams: []
            } as const;
            const [members, teams] = await Promise.all([
              listOrganizationMemberRecords(access),
              listTeamRecords(access)
            ]);
            return [
              organization.id,
              {
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
            ] as const;
          })
      )
    : [];
  const administrationByOrganization = Object.fromEntries(
    administrationEntries
  );

  return (
    <Box className={classes.page}>
      <Container className={classes.shell} size="xl">
        <Group className={classes.header} justify="space-between">
          <Group gap="sm">
            <ThemeIcon radius="md" size="lg" variant="gradient">
              <IconBrain size={20} stroke={1.7} />
            </ThemeIcon>
            <Text fw={700} size="lg">
              Agent Memory
            </Text>
            <Badge color="teal" variant="light">
              Self-hosted
            </Badge>
          </Group>
          <ThemeToggle />
        </Group>

        {user ? (
          <Workspace
            administrationByOrganization={administrationByOrganization}
            organizations={organizations}
            user={user}
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
                  Agent Studio와 연결되는 장기 기억, RAG, Knowledge Graph를
                  하나의 권한 모델과 MCP endpoint로 운영합니다.
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
