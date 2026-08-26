"use client";

import { createTheme, type MantineColorsTuple } from "@mantine/core";

const brand: MantineColorsTuple = [
  "#f4f3fe",
  "#e9e7fd",
  "#d5d1fb",
  "#c0b8f9",
  "#ab9df8",
  "#957ef5",
  "#805fe9",
  "#6b3dd8",
  "#5b33b8",
  "#4b2a99"
];

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 7 },
  colors: { brand },
  fontFamily:
    'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace:
    'var(--font-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  radius: { xl: "20px" },
  defaultRadius: "lg",
  focusRing: "auto",
  headings: {
    fontFamily:
      'var(--font-display), var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontWeight: "600"
  },
  components: {
    Button: { defaultProps: { size: "sm" } },
    ActionIcon: { defaultProps: { variant: "subtle", color: "gray" } },
    Paper: { defaultProps: { radius: "lg" } },
    Badge: { defaultProps: { variant: "light", color: "gray", radius: "sm" } },
    TextInput: { defaultProps: { size: "sm" } },
    Textarea: { defaultProps: { size: "sm" } },
    PasswordInput: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    Modal: { defaultProps: { radius: "md", centered: false } },
    Tooltip: { defaultProps: { withArrow: true, fz: "xs" } }
  }
});
