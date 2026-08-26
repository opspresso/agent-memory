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

import { I18nProvider } from "./_i18n/provider";
import { resolveLocale } from "./_i18n/server";
import { theme } from "./theme";

export const metadata: Metadata = {
  title: "Agent Memory",
  description: "AI Agent의 Memory, RAG, Knowledge Graph를 연결하는 Context 플랫폼"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveLocale();

  return (
    <html lang={locale} {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <I18nProvider locale={locale}>
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
          </I18nProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
