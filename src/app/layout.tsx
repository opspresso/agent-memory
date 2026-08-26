import "@mantine/core/styles.layer.css";

import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps
} from "@mantine/core";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { theme } from "./theme";

export const metadata: Metadata = {
  title: "Agent Memory",
  description: "조직과 팀, 사용자를 위한 설치형 AI Agent Memory 플랫폼"
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
        </MantineProvider>
      </body>
    </html>
  );
}
