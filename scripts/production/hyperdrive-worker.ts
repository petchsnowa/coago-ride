import { withDatabase } from "@coago/db";
import { probeDatabase } from "../database-readiness/probe";
type Bindings = {
  PROBE_TOKEN: string;
  HYPERDRIVE?: { connectionString: string };
};
export default {
  async fetch(request: Request, env: Bindings) {
    const headers = { "Cache-Control": "no-store" };
    if (
      !env.PROBE_TOKEN ||
      request.method !== "GET" ||
      new URL(request.url).pathname !== "/" ||
      request.headers.get("Authorization") !== `Bearer ${env.PROBE_TOKEN}`
    )
      return new Response("Not found", { status: 404, headers });
    if (!env.HYPERDRIVE)
      return Response.json(
        { error: "HYPERDRIVE_BINDING_MISSING" },
        { status: 503, headers },
      );
    try {
      const result = await withDatabase(
        env.HYPERDRIVE.connectionString,
        async (_db, client) => {
          const schema = await probeDatabase(client);
          if (
            !schema.postgis ||
            schema.appTables !== 8 ||
            schema.migrations !== 7
          )
            throw new Error("SCHEMA_NOT_READY");
          const spatial = (
            await client.query(
              "SELECT ST_AsText(ST_SetSRID(ST_MakePoint(100.5018,13.7563),4326)) AS point,ST_SRID(ST_SetSRID(ST_MakePoint(100.5018,13.7563),4326)) AS srid",
            )
          ).rows[0];
          return { ...schema, ...spatial };
        },
      );
      return Response.json({ transport: "hyperdrive", ...result }, { headers });
    } catch {
      return Response.json(
        { error: "PRODUCTION_HYPERDRIVE_UNAVAILABLE" },
        { status: 503, headers },
      );
    }
  },
};
