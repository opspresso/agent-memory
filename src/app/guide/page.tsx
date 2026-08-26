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

import { ThemeToggle } from "../theme-toggle";
import classes from "./guide.module.css";

export const metadata: Metadata = {
  title: "Guide · Agent Memory",
  description: "Agent Memory의 검색, Memory, 문서, Knowledge Graph와 MCP 사용 가이드"
};

const chapters = [
  { id: "start", label: "시작하기" },
  { id: "search", label: "Context 검색" },
  { id: "memory", label: "Memory 관리" },
  { id: "documents", label: "문서 수집" },
  { id: "graph", label: "Graph 탐색" },
  { id: "review", label: "AI 후보 검토" },
  { id: "connect", label: "Agent 연결" }
] as const;

const scopes = [
  {
    name: "Organization",
    audience: "조직 멤버",
    manager: "admin · owner",
    color: "indigo"
  },
  {
    name: "Team",
    audience: "해당 팀 멤버",
    manager: "manager 이상",
    color: "teal"
  },
  {
    name: "User",
    audience: "본인",
    manager: "본인",
    color: "violet"
  }
] as const;

function ChapterLabel({ children }: { readonly children: string }) {
  return (
    <Text className={classes.chapterLabel} fw={800} size="xs" tt="uppercase">
      {children}
    </Text>
  );
}

export default function GuidePage() {
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
              Console
            </Button>
            <ThemeToggle />
          </Group>
        </header>

        <main>
          <section className={classes.hero}>
            <Stack className={classes.heroCopy} gap="lg">
              <Badge className={classes.eyebrow} color="indigo" variant="light">
                Product guide · 7 chapters
              </Badge>
              <Title className={classes.title} order={1}>
                기억을 넣는 법보다,
                <br />다시 믿고 쓰는 법.
              </Title>
              <Text c="dimmed" className={classes.lead} size="xl">
                Memory와 문서, Knowledge Graph를 출처와 함께 연결해 다음 Agent가
                바로 활용할 수 있는 Context로 만듭니다.
              </Text>
            </Stack>

            <div aria-label="Agent Memory context flow" className={classes.contextMap}>
              <div className={classes.mapSource}>
                <span>01</span>
                <strong>Memory · Documents</strong>
                <small>근거와 scope를 함께 저장</small>
              </div>
              <div className={classes.mapPulse}>Context</div>
              <div className={classes.mapSource}>
                <span>02</span>
                <strong>Search · Graph</strong>
                <small>필요한 Context를 정확하게 발견</small>
              </div>
              <div className={classes.mapTarget}>
                <span>03</span>
                <strong>Human · Agent</strong>
                <small>출처를 아는 답변과 행동</small>
              </div>
            </div>
          </section>

          <div className={classes.guideLayout}>
            <nav aria-label="Guide 목차" className={classes.rail}>
              <Text c="dimmed" fw={800} size="xs" tt="uppercase">On this page</Text>
              {chapters.map((chapter, index) => (
                <Anchor href={`#${chapter.id}`} key={chapter.id} underline="never">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {chapter.label}
                </Anchor>
              ))}
            </nav>

            <div className={classes.content}>
              <section className={classes.chapter} id="start">
                <ChapterLabel>01 · 시작하기</ChapterLabel>
                <Title order={2}>Scope를 먼저 선택합니다.</Title>
                <Text c="dimmed">
                  모든 Memory, 문서, Knowledge node와 edge는 하나의 조직과 하나의 scope에
                  속합니다. 저장하기 전에 누가 이 Context를 함께 사용할지 결정하세요.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                  {scopes.map((scope) => (
                    <Paper className={classes.scopeCard} key={scope.name} p="lg" radius="lg">
                      <Badge color={scope.color} variant="light">{scope.name}</Badge>
                      <Text fw={750} mt="md">읽기 · {scope.audience}</Text>
                      <Text c="dimmed" size="sm">관리 · {scope.manager}</Text>
                    </Paper>
                  ))}
                </SimpleGrid>
                <Paper className={classes.note} p="lg" radius="lg">
                  <ThemeIcon color="indigo" radius="xl" variant="light">
                    <IconShieldCheck size={19} />
                  </ThemeIcon>
                  <Text size="sm">
                    선택한 scope에 맞는 Context를 검색하고, 현재 활용할 수 있는 Source와
                    연결된 Graph를 함께 보여줍니다.
                  </Text>
                </Paper>
              </section>

              <section className={classes.chapter} id="search">
                <ChapterLabel>02 · Context 검색</ChapterLabel>
                <Title order={2}>질문에 맞는 검색 면을 고릅니다.</Title>
                <Text c="dimmed">
                  `All Context`는 Memory, 처리된 문서 chunk, Knowledge node를 한 순위로
                  합칩니다. 특정 출처만 살피려면 Memory, Documents, Graph를 선택하세요.
                </Text>
                <div className={classes.steps}>
                  <div><IconSearch size={20} /><strong>검색어 입력</strong><span>정책, 장애 대응, 시스템 관계</span></div>
                  <div><IconBrain size={20} /><strong>관련도 확인</strong><span>lexical과 선택형 vector score</span></div>
                  <div><IconCheck size={20} /><strong>근거 확인</strong><span>Memory 또는 document chunk provenance</span></div>
                </div>
                <Text c="dimmed" size="sm">
                  상대 관련도는 현재 결과 중 최고 score를 100%로 표시한 값입니다. 서로
                  다른 검색 요청의 품질을 절대값으로 비교하지 마세요.
                </Text>
              </section>

              <section className={classes.chapter} id="memory">
                <ChapterLabel>03 · Memory 관리</ChapterLabel>
                <Title order={2}>결정의 현재 상태와 변경 이유를 함께 남깁니다.</Title>
                <Text c="dimmed">
                  Memory는 rule, experience, decision, preference, fact 중 하나입니다.
                  검색 결과의 `Lifecycle`에서 내용을 수정하고 변경 사유를 기록할 수 있습니다.
                </Text>
                <div className={classes.versionLine}>
                  <div><span>v1</span><strong>최초 기록</strong></div>
                  <div><span>v2</span><strong>Revision</strong></div>
                  <div><span>v3</span><strong>현재 상태</strong></div>
                </div>
                <Text c="dimmed" size="sm">
                  저장은 현재 version을 기준으로 충돌을 확인합니다. 다른 사용자가 먼저
                  수정했다면 최신 version을 다시 불러온 뒤 변경하세요. Archive는 삭제가
                  아니라 검색에서 제외되는 새 version입니다.
                </Text>
              </section>

              <section className={classes.chapter} id="documents">
                <ChapterLabel>04 · 문서 수집</ChapterLabel>
                <Title order={2}>원본은 보존하고, 검색은 chunk로 수행합니다.</Title>
                <Text c="dimmed">
                  UTF-8 text, Markdown, CSV, JSON, XML 파일을 최대 10 MiB까지 업로드할 수
                  있습니다. 원본은 S3 호환 storage에, 처리 상태와 chunk는 PostgreSQL에
                  저장됩니다.
                </Text>
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
                  `failed` 문서는 오류를 확인한 뒤 다시 처리할 수 있습니다. `ready`가 되기
                  전에는 검색 결과에 포함되지 않습니다.
                </Text>
              </section>

              <section className={classes.chapter} id="graph">
                <ChapterLabel>05 · Graph 탐색</ChapterLabel>
                <Title order={2}>관계를 따라가되, 근거에서 멀어지지 않습니다.</Title>
                <Text c="dimmed">
                  Graph 검색 결과에서 `관계 보기`를 누르면 선택 node를 중심으로 방향성
                  edge와 predicate가 표시됩니다. Node를 선택하면 inspector가 바뀌고, 같은
                  node를 다시 선택하면 그 node가 새로운 중심이 됩니다.
                </Text>
                <Paper className={classes.graphDemo} p="xl" radius="lg">
                  <div className={classes.demoNode} data-kind="agent">Agent</div>
                  <span className={classes.demoEdge}>queries</span>
                  <div className={classes.demoNode} data-kind="memory">Memory</div>
                  <span className={classes.demoEdge}>grounded by</span>
                  <div className={classes.demoNode} data-kind="source">Source</div>
                </Paper>
                <Text c="dimmed" size="sm">
                  각 node와 edge는 Memory 또는 document chunk 중 정확히 하나를 가리키는
                  provenance를 하나 이상 가집니다. 키보드에서는 `Enter` 또는 `Space`로
                  node를 선택할 수 있습니다.
                </Text>
              </section>

              <section className={classes.chapter} id="review">
                <ChapterLabel>06 · AI 후보 검토</ChapterLabel>
                <Title order={2}>AI의 제안을 검토해 지식을 완성합니다.</Title>
                <Text c="dimmed">
                  AI Extractor가 문서에서 찾은 entity와 relationship은 검토 queue에 먼저
                  들어갑니다. Source, model, entity, 관계를 살펴보고 Graph에 반영할 내용을
                  선택하세요.
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Paper className={classes.decisionCard} p="lg" radius="lg">
                    <IconSparkles size={22} />
                    <Text fw={750}>Graph에 승인</Text>
                    <Text c="dimmed" size="sm">Canonical node·edge와 provenance를 transaction으로 저장</Text>
                  </Paper>
                  <Paper className={classes.decisionCard} p="lg" radius="lg">
                    <IconShieldCheck size={22} />
                    <Text fw={750}>이번에는 반영하지 않기</Text>
                    <Text c="dimmed" size="sm">검토 기록을 남겨 다음 판단에 활용</Text>
                  </Paper>
                </SimpleGrid>
              </section>

              <section className={classes.chapter} id="connect">
                <ChapterLabel>07 · Agent 연결</ChapterLabel>
                <Title order={2}>MCP로 Agent와 Context를 연결합니다.</Title>
                <Text c="dimmed">
                  `Agent 연결` 탭에서 현재 사이트 주소와 활성 조직 ID가 포함된 전체
                  Streamable HTTP MCP endpoint를 확인하고 복사합니다. Better Auth 로그인
                  응답의 `set-auth-token` 값을 Bearer token으로 전달하세요.
                </Text>
                <Paper className={classes.endpoint} p="lg" radius="lg">
                  <IconPlugConnected size={21} />
                  <Text size="sm">실제 연결 주소는 Console에서 활성 조직에 맞게 생성됩니다.</Text>
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
                  <Title order={2}>이제 실제 Context를 탐색하세요.</Title>
                  <Text c="dimmed">운영 콘솔에서 검색을 시작하거나 Agent에 MCP endpoint를 연결합니다.</Text>
                </Stack>
                <Button component="a" href="/" size="md">Console 열기</Button>
              </section>
            </div>
          </div>
        </main>
      </Container>
    </Box>
  );
}
