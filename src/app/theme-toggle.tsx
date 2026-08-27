"use client";

import {
  ActionIcon,
  Menu,
  useMantineColorScheme,
  type MantineColorScheme
} from "@mantine/core";
import { useMounted } from "@mantine/hooks";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";

import type { MessageKey } from "./_i18n/messages/en";
import { useT } from "./_i18n/provider";

const options = [
  { value: "auto", label: "theme.system", Icon: IconDeviceDesktop },
  { value: "light", label: "theme.light", Icon: IconSun },
  { value: "dark", label: "theme.dark", Icon: IconMoon }
] as const satisfies ReadonlyArray<{
  readonly value: MantineColorScheme;
  readonly label: MessageKey;
  readonly Icon: typeof IconSun;
}>;

export function ThemeToggle() {
  const t = useT();
  const mounted = useMounted();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const visibleColorScheme = mounted ? colorScheme : "auto";
  const current =
    options.find((option) => option.value === visibleColorScheme) ?? options[0];
  const CurrentIcon = current.Icon;

  return (
    <Menu position="bottom-end" width={140} withinPortal>
      <Menu.Target>
        <ActionIcon
          aria-label={t("theme.current", { name: t(current.label) })}
          size="lg"
          title={t(current.label)}
          variant="default"
        >
          <CurrentIcon size={18} stroke={1.8} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {options.map(({ value, label, Icon }) => (
          <Menu.Item
            data-active={visibleColorScheme === value || undefined}
            key={value}
            leftSection={<Icon size={16} stroke={1.8} />}
            onClick={() => setColorScheme(value)}
          >
            {t(label)}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
