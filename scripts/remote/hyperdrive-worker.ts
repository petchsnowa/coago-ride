import app, { type Bindings } from "../../apps/api/src/index";
import { withDatabase } from "@coago/db";
type ProbeBindings = Bindings & { PROBE_TOKEN: string };
export default {
  async fetch(request: Request, env: ProbeBindings): Promise<Response> {
    if (
      !env.PROBE_TOKEN ||
      request.headers.get("Authorization") !== `Bearer ${env.PROBE_TOKEN}`
    )
      return new Response("Not found", { status: 404 });
    if (!env.HYPERDRIVE)
      return Response.json(
        { error: "HYPERDRIVE_BINDING_MISSING" },
        { status: 503 },
      );
    const ready = await app.request(
      "/health/ready",
      {},
      { ENVIRONMENT: "remote-test", HYPERDRIVE: env.HYPERDRIVE },
    );
    if (ready.status !== 200)
      return Response.json(
        { error: "REMOTE_READINESS_UNAVAILABLE" },
        { status: 503 },
      );
    try {
      const result = await withDatabase(
        env.HYPERDRIVE.connectionString,
        async (_db, client) => {
          const query =
            await client.query(`SELECT current_setting('server_version') AS postgres,
          postgis_lib_version() AS postgis,
          ST_AsText(ST_SetSRID(ST_MakePoint(100.5018,13.7563),4326)) AS point,
          ST_SRID(ST_SetSRID(ST_MakePoint(100.5018,13.7563),4326)) AS srid`);
          return query.rows[0];
        },
      );
      return Response.json({
        transport: "hyperdrive",
        readiness: ready.status,
        ...result,
      });
    } catch {
      return Response.json(
        { error: "REMOTE_SPATIAL_QUERY_FAILED" },
        { status: 503 },
      );
    }
  },
};
