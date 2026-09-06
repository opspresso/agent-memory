"use client";

import { createTheme, type MantineColorsTuple } from "@mantine/core";

const brand: MantineColorsTuple = [
  "#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8",
  "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81"
];

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 5 },
  colors: { brand },
  fontFamily:
    'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace:
    'var(--font-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  radius: { xs: "4px", sm: "6px", md: "8px", lg: "10px", xl: "12px" },
  defaultRadius: "md",
  focusRing: "auto",
  headings: {
    fontFamily:
      'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontWeight: "650",
    sizes: { h1: { fontSize: "1.75rem", lineHeight: "1.25" }, h2: { fontSize: "1.25rem", lineHeight: "1.35" }, h3: { fontSize: "1.05rem", lineHeight: "1.4" } }
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
