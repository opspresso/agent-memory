import type { Locale } from "./locale";
import { en, type MessageKey, type Messages } from "./messages/en";
import { ko } from "./messages/ko";

const catalogues: Record<Locale, Messages> = { en, ko };

export type MessageVariables = Readonly<Record<string, string | number>>;
export type Translate = (
  key: MessageKey,
  variables?: MessageVariables
) => string;

function interpolate(
  template: string,
  variables: MessageVariables | undefined
): string {
  if (!variables) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in variables ? String(variables[name]) : placeholder
  );
}

export function translator(locale: Locale): Translate {
  const catalogue = catalogues[locale];
  return (key, variables) =>
    interpolate(catalogue[key] ?? en[key], variables);
}
