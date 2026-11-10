import pg from "pg";
import { bootstrapConfig, bootstrapEmptyDatabase } from "./bootstrap";
import { probeDatabase } from "../database-readiness/probe";
import { safeDatabaseFailure } from "../database-readiness/config";

async function main() {
  const config = bootstrapConfig(process.env),
    origin = config.origin;
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
    const before = await probeDatabase(client);
    console.log("PRODUCTION_DATABASE_BEFORE", JSON.stringify(before));
    if (config.operation === "check") {
      console.log("PASS read-only production check; no migrations applied");
      return;
    }
    const result = await bootstrapEmptyDatabase(client);
    console.log("PRODUCTION_BOOTSTRAP_RESULT", JSON.stringify(result));
    console.log(
      "PASS approved empty production database: migration history and schema verified; no test users/trips copied",
    );
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  // Only fixed validation codes, never provider messages, connection strings or rows.
  const known =
    /^(?:BOOTSTRAP_[A-Z_]+|DATABASE_TARGET_REQUIRED|DATABASE_SECRET_MISSING|DATABASE_PORT_INVALID|PRODUCTION_PROJECT_CONFIRMATION_REQUIRED|PRODUCTION_HOST_MISMATCH|PRODUCTION_DATABASE_NAME_MISMATCH|TEST_DATABASE_REFERENCE_REQUIRED|PRODUCTION_MUST_NOT_USE_TEST_HOST|NEON_(?:URL_SCHEME|HOST|DIRECT_HOST|CREDENTIALS|DATABASE_NAME|TLS)_REQUIRED|TEST_DATABASE_URL_INVALID(?:_ENCODING)?)$/.test(
      message,
    );
  console.error(known ? message : safeDatabaseFailure(error));
  process.exitCode = 1;
});
