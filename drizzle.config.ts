import type { Config } from "drizzle-kit";

export default {
  schema: "./src/core/db.ts",
  out: "./migrations",
  driver: "better-sqlite",
  dbCredentials: {
    url: process.env.JUST_TS_DB ?? "./one-base.db",
  },
} satisfies Config;
