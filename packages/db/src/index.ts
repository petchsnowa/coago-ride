import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
export * from "./schema";
export * from "./version";
export function createClient(connectionString: string) {
  return new pg.Client({
    connectionString,
    connectionTimeoutMillis: 1500,
    statement_timeout: 2500,
    query_timeout: 3000,
  });
}
export async function withDatabase<T>(
  url: string,
  work: (db: NodePgDatabase, client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = createClient(url);
  try {
    await client.connect();
    return await work(drizzle(client), client);
  } finally {
    await client.end();
  }
}
export async function checkDatabase(url: string): Promise<void> {
  await withDatabase(url, async (_db, client) => {
    await client.query("SELECT PostGIS_Full_Version()");
  });
}
