import { Badge, Container, Group, Stack, Text, Title } from "@mantine/core";

import { ThemeToggle } from "./theme-toggle";

export default function Home() {
  return (
    <Container size="sm" py="20vh">
      <Stack gap="xl">
        <Group justify="space-between">
          <Badge variant="light">Self-hosted</Badge>
          <ThemeToggle />
        </Group>
        <Stack gap="sm">
          <Title order={1}>Agent Memory</Title>
          <Text c="dimmed" size="lg">
            조직 규칙, 팀 경험, 사용자 선호와 RAG 문서를 권한 범위 안에서
            연결하는 AI Agent Memory 플랫폼
          </Text>
        </Stack>
      </Stack>
    </Container>
  );
}
