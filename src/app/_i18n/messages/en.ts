export const en = {
  "locale.label": "Language",
  "locale.change": "Change language",
  "theme.toggle": "Toggle theme"
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
