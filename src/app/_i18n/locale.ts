export const LOCALES = ["en", "ko"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "agent-memory-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ko: "한국어"
};

export function isLocale(value: string | undefined | null): value is Locale {
  return value !== undefined &&
    value !== null &&
    (LOCALES as readonly string[]).includes(value);
}

export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) {
    return DEFAULT_LOCALE;
  }

  const ranked = header
    .toLowerCase()
    .split(",")
    .map((entry) => {
      const [range = "", ...parameters] = entry.split(";");
      const quality = parameters
        .map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter.trim()))
        .find((match) => match !== null);
      return {
        locale: range.trim().split("-")[0] ?? "",
        quality: quality ? Number(quality[1]) : 1
      };
    })
    .filter(
      (entry) =>
        entry.locale !== "" &&
        Number.isFinite(entry.quality) &&
        entry.quality > 0
    )
    .sort((left, right) => right.quality - left.quality);

  for (const entry of ranked) {
    if (isLocale(entry.locale)) {
      return entry.locale;
    }
  }
  return DEFAULT_LOCALE;
}
