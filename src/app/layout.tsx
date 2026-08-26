import "@mantine/core/styles.layer.css";

import {
  Anchor,
  Box,
  ColorSchemeScript,
  Group,
  MantineProvider,
  Text,
  mantineHtmlProps
} from "@mantine/core";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import packageJson from "../../package.json";

import { theme } from "./theme";

export const metadata: Metadata = {
  title: "Agent Memory",
  description: "AI Agent의 Memory, RAG, Knowledge Graph를 연결하는 Context 플랫폼"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="auto">
          {children}
          <Box
            component="footer"
            px="md"
            py="sm"
            style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
          >
            <Group gap="xs" justify="center" wrap="wrap">
              <Text c="dimmed" size="xs">
                Agent Memory v{packageJson.version}
              </Text>
              <Text c="dimmed" size="xs">·</Text>
              <Text c="dimmed" size="xs">
                © {new Date().getUTCFullYear()} {" "}
                <Anchor
                  c="dimmed"
                  href="https://opspresso.com"
                  rel="noreferrer"
                  target="_blank"
                >
                  Opspresso
                </Anchor>
              </Text>
            </Group>
          </Box>
        </MantineProvider>
      </body>
    </html>
  );
}
