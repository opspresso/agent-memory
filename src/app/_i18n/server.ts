import { cookies, headers } from "next/headers";

import {
  isLocale,
  LOCALE_COOKIE,
  negotiateLocale,
  type Locale
} from "./locale";
import { translator, type Translate } from "./translate";

export async function resolveLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) {
    return stored;
  }
  return negotiateLocale((await headers()).get("accept-language"));
}

export async function getT(): Promise<Translate> {
  return translator(await resolveLocale());
}
