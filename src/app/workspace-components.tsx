import { Group, Paper, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

import classes from "./workspace-components.module.css";

interface WorkspaceHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly eyebrow?: string;
  readonly actions?: ReactNode;
}

export function WorkspaceHeader({ title, description, eyebrow, actions }: WorkspaceHeaderProps) {
  return (
    <header className={classes.header}>
      <Stack gap={4}>
        {eyebrow ? <Text c="dimmed" size="xs" fw={600}>{eyebrow}</Text> : null}
        <Title order={1}>{title}</Title>
        {description ? <Text className={classes.description} c="dimmed" size="sm">{description}</Text> : null}
      </Stack>
      {actions ? <Group gap="xs" className={classes.actions}>{actions}</Group> : null}
    </header>
  );
}

export function WorkspaceSection({ title, description, actions, children }: {
  readonly title?: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Paper component="section" p={{ base: "md", sm: "lg" }} withBorder>
      <Stack gap="md">
        {title || description || actions ? (
          <Group align="flex-start" justify="space-between">
            <Stack gap={4}>
              {title ? <Title order={2}>{title}</Title> : null}
              {description ? <Text c="dimmed" size="sm">{description}</Text> : null}
            </Stack>
            {actions}
          </Group>
        ) : null}
        {children}
      </Stack>
    </Paper>
  );
}

export function EmptyState({ title, description, icon, action }: {
  readonly title: string;
  readonly description: string;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className={classes.empty}>
      {icon ? <span className={classes.emptyIcon} aria-hidden>{icon}</span> : null}
      <Title order={2}>{title}</Title>
      <Text c="dimmed" size="sm" maw={460}>{description}</Text>
      {action}
    </div>
  );
}
