import { decodeDiscoveryCursor } from "./cursor";
import { Hono } from "hono";
import { z } from "zod";
import {
  tripSearchSchema,
  publicTripListSchema,
  publicTripResponseSchema,
} from "@coago/contracts";
import { type Bindings, databaseUrl } from "../bindings";
import { postgresDiscoveryStore, type DiscoveryStore } from "./store";
export type DiscoveryDependencies = {
  store: (url: string) => DiscoveryStore;
  now: () => Date;
};
export function discoveryRoutes(
  overrides: Partial<DiscoveryDependencies> = {},
) {
  const deps = {
    store: postgresDiscoveryStore,
    now: () => new Date(),
    ...overrides,
  };
  const app = new Hono<{ Bindings: Bindings }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/", async (c) => {
    const query = new URL(c.req.url).searchParams;
    const entries = [...query.entries()];
    if (
      new Set(entries.map(([key]) => key)).size !== entries.length ||
      entries.some(
        ([key]) =>
          !["originProvince", "destinationProvince", "date", "cursor"].includes(
            key,
          ),
      )
    )
      return c.json({ error: "invalid_search" }, 400);
    const { cursor: raw, ...fields } = Object.fromEntries(entries);
    const input = tripSearchSchema.safeParse(fields);
    if (!input.success) return c.json({ error: "invalid_search" }, 400);
    let cursor;
    try {
      if (raw !== undefined) {
        cursor = decodeDiscoveryCursor(raw);
        if (
          cursor.originProvince !== input.data.originProvince ||
          cursor.destinationProvince !== input.data.destinationProvince ||
          cursor.date !== input.data.date
        )
          throw new Error();
      }
    } catch {
      return c.json({ error: "invalid_cursor" }, 400);
    }
    return c.json(
      publicTripListSchema.parse(
        await deps
          .store(databaseUrl(c.env))
          .search(input.data, deps.now(), cursor),
      ),
    );
  });
  app.get("/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "invalid_trip_id" }, 400);
    const trip = await deps
      .store(databaseUrl(c.env))
      .detail(id.data, deps.now());
    return trip
      ? c.json(publicTripResponseSchema.parse({ trip }))
      : c.json({ error: "trip_not_found" }, 404);
  });
  app.onError((_error, c) => c.json({ error: "service_unavailable" }, 503));
  return app;
}
