import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createClient } from "@coago/db";
import { testDatabaseUrl } from "./database";
const client = createClient(testDatabaseUrl());
try {
  await client.connect();
  await migrate(drizzle(client), {
    migrationsFolder: "packages/db/migrations",
  });
  console.log("Migrations applied");
} finally {
  await client.end();
}
