import { customType } from "drizzle-orm/pg-core";

export const unconstrainedVector = customType<{
  data: readonly number[];
  driverData: string;
}>({
  dataType() {
    return "vector";
  },
  fromDriver(value) {
    return value
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map(Number);
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  }
});

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  }
});
