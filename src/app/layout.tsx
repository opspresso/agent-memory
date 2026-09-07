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
import { Figtree, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { listOrganizationMemberships } from "@/lib/organization-service";
import { getSessionUser } from "@/lib/session";

import packageJson from "../../package.json";

import { AppShellFrame } from "./app-shell";
import { I18nProvider } from "./_i18n/provider";
import { getT, resolveLocale } from "./_i18n/server";
import { OrganizationProvider } from "./organization-context";
import { theme } from "./theme";

import "./globals.css";

const sans = Figtree({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: "Agent Memory", description: t("meta.description") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveLocale();
  const user = await getSessionUser(new Headers(await headers()));
  const organizations = user
    ? await listOrganizationMemberships(user)
    : [];

  return (
    <html
      className={`${sans.variable} ${mono.variable}`}
      lang={locale}
      {...mantineHtmlProps}
    >
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <I18nProvider locale={locale}>
            <OrganizationProvider organizations={organizations}>
              <AppShellFrame user={user} version={packageJson.version}>
                {children}
                {!user ? <Box
                  component="footer"
                  mt="xl"
                  py="sm"
                  style={{
                    borderTop: "1px solid var(--mantine-color-default-border)"
                  }}
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
                </Box> : null}
              </AppShellFrame>
            </OrganizationProvider>
          </I18nProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
