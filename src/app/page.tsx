import {
  Badge,
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
import { redirect } from "next/navigation";

import { listOrganizationMemberships } from "@/lib/organization-service";
import { getSessionUser } from "@/lib/session";

import { LoginPanel } from "./login-panel";
import { getT } from "./_i18n/server";
import type { MessageKey } from "./_i18n/messages/en";
import classes from "./page.module.css";
import { SearchConsole } from "./search-console";

export const dynamic = "force-dynamic";

const capabilities = [
  {
    icon: IconBrain,
    title: "home.capability.memory",
    description: "home.capability.memoryBody"
  },
  {
    icon: IconFileSearch,
    title: "home.capability.rag",
    description: "home.capability.ragBody"
  },
  {
    icon: IconBinaryTree,
    title: "home.capability.graph",
    description: "home.capability.graphBody"
  },
  {
    icon: IconShieldLock,
    title: "home.capability.sharing",
    description: "home.capability.sharingBody"
  }
] as const satisfies readonly {
  readonly icon: typeof IconBrain;
  readonly title: MessageKey;
  readonly description: MessageKey;
}[];

export default async function Home() {
  const t = await getT();
  const user = await getSessionUser(new Headers(await headers()));

  if (user) {
    const organizations = await listOrganizationMemberships(user);
    const activeOrganizations = organizations.filter(
      (organization) => organization.status === "active"
    );
    if (activeOrganizations.length === 0) {
      redirect("/onboarding");
    }
    return <SearchConsole />;
  }

  return (
    <div className={classes.hero}>
      <Stack className={classes.intro} gap="xl">
        <Badge className={classes.eyebrow} size="lg" variant="light">
          {t("home.eyebrow")}
        </Badge>
        <Stack gap="md">
          <Title className={classes.title} order={1}>
            {t("home.title")}
            <br />{t("home.titleSecond")}
          </Title>
          <Text className={classes.lead} c="dimmed" size="xl">
            {t("home.lede")}
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
              <ThemeIcon color="brand" variant="light">
                <capability.icon size={18} stroke={1.7} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text fw={650}>{t(capability.title)}</Text>
                <Text c="dimmed" size="sm">
                  {t(capability.description)}
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
    </div>
  );
}
