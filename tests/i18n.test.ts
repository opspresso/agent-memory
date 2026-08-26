import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  LOCALE_LABELS,
  negotiateLocale
} from "@/app/_i18n/locale";
import { en } from "@/app/_i18n/messages/en";
import { ko } from "@/app/_i18n/messages/ko";
import { translator } from "@/app/_i18n/translate";

describe("negotiateLocale", () => {
  it("matches a supported primary language subtag", () => {
    expect(negotiateLocale("ko-KR,ko;q=0.9")).toBe("ko");
  });

  it("uses quality values instead of header order", () => {
    expect(negotiateLocale("en;q=0.3, ko;q=0.9")).toBe("ko");
  });

  it("skips unsupported and explicitly refused languages", () => {
    expect(negotiateLocale("fr-FR,ko;q=0,en;q=0.5")).toBe("en");
  });

  it.each([undefined, null, "", "fr-FR"])("falls back on %o", (header) => {
    expect(negotiateLocale(header)).toBe(DEFAULT_LOCALE);
  });
});

describe("locale catalogues", () => {
  it.each(LOCALES)("recognizes %s", (locale) => {
    expect(isLocale(locale)).toBe(true);
  });

  it("names each language in itself", () => {
    expect(LOCALE_LABELS).toEqual({ en: "English", ko: "한국어" });
  });

  it("contains non-empty messages in both languages", () => {
    const blanks = Object.keys(en).filter(
      (key) =>
        en[key as keyof typeof en].trim() === "" ||
        ko[key as keyof typeof ko].trim() === ""
    );
    expect(blanks).toEqual([]);
  });
});

describe("translator", () => {
  it("returns the selected language", () => {
    expect(translator("en")("locale.label")).toBe("Language");
    expect(translator("ko")("locale.label")).toBe("언어");
  });
});
