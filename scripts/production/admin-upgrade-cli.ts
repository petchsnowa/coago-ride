import pg from "pg";
import { bootstrapConfig } from "./bootstrap";
import { probeDatabase } from "../database-readiness/probe";
import { safeDatabaseFailure } from "../database-readiness/config";
import { upgradeAdminSchema } from "./admin-upgrade";
async function main() {
  const { origin } = bootstrapConfig({
    ...process.env,
    COAGO_BOOTSTRAP_OPERATION: "check",
  });
  if (
    !["check", "upgrade"].includes(
      process.env.COAGO_ADMIN_UPGRADE_OPERATION ?? "",
    )
  )
    throw new Error("ADMIN_UPGRADE_OPERATION_REQUIRED");
  const client = new pg.Client({
    host: origin.host,
    port: origin.port,
    database: origin.database,
    user: origin.user,
    password: origin.password,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
    query_timeout: 35000,
  });
  try {
    await client.connect();
    console.log(
      "ADMIN_SCHEMA_BEFORE",
      JSON.stringify(await probeDatabase(client)),
    );
    if (process.env.COAGO_ADMIN_UPGRADE_OPERATION === "check") {
      console.log("PASS read-only schema check; no upgrade applied");
      return;
    }
    const result = await upgradeAdminSchema(client, {
      allowExistingData: process.env.COAGO_ALLOW_EXISTING_DATA === "true",
    });
    console.log("ADMIN_SCHEMA_UPGRADE", JSON.stringify(result));
    console.log(
      "PASS Root Admin schema upgraded without copying or deleting user/trip/request data; no deployment/DNS changes",
    );
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  console.error(
    /^[A-Z][A-Z0-9_]{1,150}$/.test(message)
      ? message
      : safeDatabaseFailure(error),
  );
  process.exitCode = 1;
});
