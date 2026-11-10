import pg from "pg";
import {
  databaseProbeConfig,
  safeDatabaseFailure,
} from "./database-readiness/config";
import { probeDatabase } from "./database-readiness/probe";

async function main() {
  const { target, origin } = databaseProbeConfig(process.env);
  const client = new pg.Client({
    host: origin.host,
    port: origin.port,
    database: origin.database,
    user: origin.user,
    password: origin.password,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    statement_timeout: 5000,
    query_timeout: 7000,
  });
  try {
    await client.connect();
    const result = await probeDatabase(client);
    console.log(
      "DATABASE_READ_ONLY_REPORT",
      JSON.stringify({ target, ...result }),
    );
    if (!result.postgis) throw new Error("POSTGIS_NOT_ENABLED");
    console.log(
      "PASS direct Neon TLS connection and PostGIS (read-only; no schema or user records changed)",
    );
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  const known =
    error instanceof Error &&
    /^(?:DATABASE_TARGET_REQUIRED|DATABASE_SECRET_MISSING|DATABASE_PORT_INVALID|PRODUCTION_PROJECT_CONFIRMATION_REQUIRED|PRODUCTION_HOST_MISMATCH|PRODUCTION_DATABASE_NAME_MISMATCH|TEST_DATABASE_REFERENCE_REQUIRED|PRODUCTION_MUST_NOT_USE_TEST_HOST|POSTGIS_NOT_ENABLED|EXPECTED_NEON_DIRECT_TEST_DATABASE_WITH_TLS|TEST_DATABASE_URL_INVALID(?:_ENCODING)?)$/.test(
      error.message,
    );
  console.error(known ? error.message : safeDatabaseFailure(error));
  process.exitCode = 1;
});
