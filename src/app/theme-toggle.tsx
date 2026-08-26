"use client";

import {
  ActionIcon,
  useComputedColorScheme,
  useMantineColorScheme
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";

import { useT } from "./_i18n/provider";
import classes from "./theme-toggle.module.css";

export function ThemeToggle() {
  const t = useT();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true
  });

  return (
    <ActionIcon
      aria-label={t("theme.toggle")}
      onClick={() =>
        setColorScheme(computedColorScheme === "light" ? "dark" : "light")
      }
      variant="default"
    >
      <IconSun className={classes.light} size={18} stroke={1.5} />
      <IconMoon className={classes.dark} size={18} stroke={1.5} />
    </ActionIcon>
  );
}
