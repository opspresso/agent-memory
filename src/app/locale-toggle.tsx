"use client";

import { ActionIcon, Menu } from "@mantine/core";
import { IconWorld } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_LABELS,
  type Locale
} from "./_i18n/locale";
import { useLocale, useT } from "./_i18n/provider";

export function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) {
      return;
    }
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    // The click deliberately persists a browser preference before refreshing.
    // eslint-disable-next-line react-hooks/immutability
    document.cookie =
      `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; ` +
      `samesite=lax${secure}`;
    startTransition(() => router.refresh());
  }

  return (
    <Menu position="bottom-end" width={140} withinPortal>
      <Menu.Target>
        <ActionIcon
          aria-label={t("locale.change")}
          loading={pending}
          size="lg"
          title={t("locale.label")}
          variant="default"
        >
          <IconWorld size={18} stroke={1.8} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {LOCALES.map((value) => (
          <Menu.Item
            data-active={value === locale || undefined}
            key={value}
            onClick={() => choose(value)}
          >
            {LOCALE_LABELS[value]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
