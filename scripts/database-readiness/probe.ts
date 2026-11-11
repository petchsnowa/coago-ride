import type pg from "pg";

export async function probeDatabase(client: pg.Client) {
  await client.query("BEGIN READ ONLY");
  try {
    const result = (
      await client.query<{
        readonly: string;
        pg: string;
        postgis: string | null;
        app_tables: number;
      }>(`
      SELECT current_setting('transaction_read_only') AS readonly,
        current_setting('server_version') AS pg,
        (SELECT extversion FROM pg_extension WHERE extname='postgis') AS postgis,
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
          AND c.relname IN ('users','external_identities','oauth_flows','auth_sessions',
            'auth_rate_limits','trips','ride_requests','system_metadata','admin_audit','site_settings')) AS app_tables
    `)
    ).rows[0];
    if (result.readonly !== "on")
      throw new Error("READ_ONLY_TRANSACTION_REQUIRED");
    const history = (
      await client.query(
        "SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name",
      )
    ).rows[0];
    let migrations: number | null = null;
    if (history.table_name)
      migrations = (
        await client.query(
          "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
        )
      ).rows[0].count;
    return {
      postgres: result.pg,
      postgis: result.postgis,
      appTables: result.app_tables,
      migrations,
    };
  } finally {
    await client.query("ROLLBACK");
  }
}
