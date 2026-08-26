import {
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Container,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title
} from "@mantine/core";
import {
  IconArrowLeft,
  IconBinaryTree,
  IconBrain,
  IconCheck,
  IconFileText,
  IconPlugConnected,
  IconSearch,
  IconShieldCheck,
  IconSparkles
} from "@tabler/icons-react";
import type { Metadata } from "next";

import type { MessageKey } from "../_i18n/messages/en";
import { getT } from "../_i18n/server";
import { LocaleToggle } from "../locale-toggle";
import { ThemeToggle } from "../theme-toggle";
import classes from "./guide.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: "Guide · Agent Memory", description: t("guide.metaDescription") };
}

const chapters = [
  { id: "start", label: "guide.chapter.start" },
  { id: "search", label: "guide.chapter.search" },
  { id: "memory", label: "guide.chapter.memory" },
  { id: "documents", label: "guide.chapter.documents" },
  { id: "graph", label: "guide.chapter.graph" },
  { id: "review", label: "guide.chapter.review" },
  { id: "connect", label: "guide.chapter.connect" }
] as const satisfies readonly { readonly id: string; readonly label: MessageKey }[];

const scopes = [
  {
    name: "Organization",
    audience: "guide.scope.organizationAudience",
    manager: "admin · owner",
    color: "indigo"
  },
  {
    name: "Team",
    audience: "guide.scope.teamAudience",
    manager: "guide.scope.teamManager",
    color: "teal"
  },
  {
    name: "User",
    audience: "guide.scope.userAudience",
    manager: "guide.scope.userManager",
    color: "violet"
  }
] as const satisfies readonly {
  readonly name: string;
  readonly audience: MessageKey;
  readonly manager: MessageKey | "admin · owner";
  readonly color: string;
}[];

function ChapterLabel({ children }: { readonly children: string }) {
  return (
    <Text className={classes.chapterLabel} fw={800} size="xs" tt="uppercase">
      {children}
    </Text>
  );
}

export default async function GuidePage() {
  const t = await getT();
  return (
    <Box className={classes.page}>
      <Container className={classes.shell} size="xl">
        <header className={classes.header}>
          <Anchor className={classes.brand} component="a" href="/" underline="never">
            <Image alt="Agent Memory logo" className={classes.logo} src="/logo.png" />
            <Text c="var(--mantine-color-text)" fw={750}>Agent Memory</Text>
          </Anchor>
          <Group gap="xs">
            <Button
              component="a"
              href="/"
              leftSection={<IconArrowLeft size={16} />}
              variant="subtle"
            >
              {t("guide.console")}
            </Button>
            <LocaleToggle />
            <ThemeToggle />
          </Group>
        </header>

        <main>
          <section className={classes.hero}>
            <Stack className={classes.heroCopy} gap="lg">
              <Badge className={classes.eyebrow} color="indigo" variant="light">
                {t("guide.eyebrow")}
              </Badge>
              <Title className={classes.title} order={1}>
                {t("guide.title")}
                <br />{t("guide.titleSecond")}
              </Title>
              <Text c="dimmed" className={classes.lead} size="xl">
                {t("guide.lede")}
              </Text>
            </Stack>

            <div aria-label={t("guide.flowLabel")} className={classes.contextMap}>
              <div className={classes.mapSource}>
                <span>01</span>
                <strong>Memory · Documents</strong>
                <small>{t("guide.flow.store")}</small>
              </div>
              <div className={classes.mapPulse}>Context</div>
              <div className={classes.mapSource}>
                <span>02</span>
                <strong>Search · Graph</strong>
                <small>{t("guide.flow.discover")}</small>
              </div>
              <div className={classes.mapTarget}>
                <span>03</span>
                <strong>Human · Agent</strong>
                <small>{t("guide.flow.use")}</small>
              </div>
            </div>
          </section>

          <div className={classes.guideLayout}>
            <nav aria-label={t("guide.contentsLabel")} className={classes.rail}>
              <Text c="dimmed" fw={800} size="xs" tt="uppercase">{t("guide.onThisPage")}</Text>
              {chapters.map((chapter, index) => (
                <Anchor href={`#${chapter.id}`} key={chapter.id} underline="never">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {t(chapter.label)}
                </Anchor>
              ))}
            </nav>

            <div className={classes.content}>
              <section className={classes.chapter} id="start">
                <ChapterLabel>{`01 · ${t("guide.chapter.start")}`}</ChapterLabel>
                <Title order={2}>{t("guide.start.title")}</Title>
                <Text c="dimmed">{t("guide.start.body")}</Text>
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                  {scopes.map((scope) => (
                    <Paper className={classes.scopeCard} key={scope.name} p="lg" radius="lg">
                      <Badge color={scope.color} variant="light">{scope.name}</Badge>
                      <Text fw={750} mt="md">{t("guide.scope.read", { audience: t(scope.audience) })}</Text>
                      <Text c="dimmed" size="sm">{t("guide.scope.manage", { manager: scope.manager === "admin · owner" ? scope.manager : t(scope.manager) })}</Text>
                    </Paper>
                  ))}
                </SimpleGrid>
                <Paper className={classes.note} p="lg" radius="lg">
                  <ThemeIcon color="indigo" radius="xl" variant="light">
                    <IconShieldCheck size={19} />
                  </ThemeIcon>
                  <Text size="sm">{t("guide.start.note")}</Text>
                </Paper>
              </section>

              <section className={classes.chapter} id="search">
                <ChapterLabel>{`02 · ${t("guide.chapter.search")}`}</ChapterLabel>
                <Title order={2}>{t("guide.search.title")}</Title>
                <Text c="dimmed">{t("guide.search.body")}</Text>
                <div className={classes.steps}>
                  <div><IconSearch size={20} /><strong>{t("guide.search.input")}</strong><span>{t("guide.search.inputNote")}</span></div>
                  <div><IconBrain size={20} /><strong>{t("guide.search.relevance")}</strong><span>{t("guide.search.relevanceNote")}</span></div>
                  <div><IconCheck size={20} /><strong>{t("guide.search.evidence")}</strong><span>{t("guide.search.evidenceNote")}</span></div>
                </div>
                <Text c="dimmed" size="sm">
                  {t("guide.search.note")}
                </Text>
              </section>

              <section className={classes.chapter} id="memory">
                <ChapterLabel>{`03 · ${t("guide.chapter.memory")}`}</ChapterLabel>
                <Title order={2}>{t("guide.memory.title")}</Title>
                <Text c="dimmed">{t("guide.memory.body")}</Text>
                <div className={classes.versionLine}>
                  <div><span>v1</span><strong>{t("guide.memory.initial")}</strong></div>
                  <div><span>v2</span><strong>Revision</strong></div>
                  <div><span>v3</span><strong>{t("guide.memory.current")}</strong></div>
                </div>
                <Text c="dimmed" size="sm">
                  {t("guide.memory.note")}
                </Text>
              </section>

              <section className={classes.chapter} id="documents">
                <ChapterLabel>{`04 · ${t("guide.chapter.documents")}`}</ChapterLabel>
                <Title order={2}>{t("guide.documents.title")}</Title>
                <Text c="dimmed">{t("guide.documents.body")}</Text>
                <div className={classes.pipeline}>
                  {[
                    ["Upload", "pending"],
                    ["Worker", "processing"],
                    ["Search", "ready"]
                  ].map(([label, state]) => (
                    <div key={label}>
                      <IconFileText size={20} />
                      <strong>{label}</strong>
                      <Code>{state}</Code>
                    </div>
                  ))}
                </div>
                <Text c="dimmed" size="sm">
                  {t("guide.documents.note")}
                </Text>
              </section>

              <section className={classes.chapter} id="graph">
                <ChapterLabel>{`05 · ${t("guide.chapter.graph")}`}</ChapterLabel>
                <Title order={2}>{t("guide.graph.title")}</Title>
                <Text c="dimmed">{t("guide.graph.body")}</Text>
                <Paper className={classes.graphDemo} p="xl" radius="lg">
                  <div className={classes.demoNode} data-kind="agent">Agent</div>
                  <span className={classes.demoEdge}>queries</span>
                  <div className={classes.demoNode} data-kind="memory">Memory</div>
                  <span className={classes.demoEdge}>grounded by</span>
                  <div className={classes.demoNode} data-kind="source">Source</div>
                </Paper>
                <Text c="dimmed" size="sm">
                  {t("guide.graph.note")}
                </Text>
              </section>

              <section className={classes.chapter} id="review">
                <ChapterLabel>{`06 · ${t("guide.chapter.review")}`}</ChapterLabel>
                <Title order={2}>{t("guide.review.title")}</Title>
                <Text c="dimmed">{t("guide.review.body")}</Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Paper className={classes.decisionCard} p="lg" radius="lg">
                    <IconSparkles size={22} />
                    <Text fw={750}>{t("guide.review.accept")}</Text>
                    <Text c="dimmed" size="sm">{t("guide.review.acceptNote")}</Text>
                  </Paper>
                  <Paper className={classes.decisionCard} p="lg" radius="lg">
                    <IconShieldCheck size={22} />
                    <Text fw={750}>{t("guide.review.reject")}</Text>
                    <Text c="dimmed" size="sm">{t("guide.review.rejectNote")}</Text>
                  </Paper>
                </SimpleGrid>
              </section>

              <section className={classes.chapter} id="connect">
                <ChapterLabel>{`07 · ${t("guide.chapter.connect")}`}</ChapterLabel>
                <Title order={2}>{t("guide.connect.title")}</Title>
                <Text c="dimmed">{t("guide.connect.body")}</Text>
                <Paper className={classes.endpoint} p="lg" radius="lg">
                  <IconPlugConnected size={21} />
                  <Text size="sm">{t("guide.connect.note")}</Text>
                </Paper>
                <div className={classes.toolList}>
                  {[
                    "context_search",
                    "memory_search",
                    "memory_create",
                    "document_search",
                    "knowledge_search",
                    "knowledge_neighborhood"
                  ].map((tool) => <Code key={tool}>{tool}</Code>)}
                </div>
              </section>

              <section className={classes.nextStep}>
                <IconBinaryTree size={30} />
                <Stack gap={4}>
                  <Title order={2}>{t("guide.next.title")}</Title>
                  <Text c="dimmed">{t("guide.next.body")}</Text>
                </Stack>
                <Button component="a" href="/" size="md">{t("guide.next.action")}</Button>
              </section>
            </div>
          </div>
        </main>
      </Container>
    </Box>
  );
}
