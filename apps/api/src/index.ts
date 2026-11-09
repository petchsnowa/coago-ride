import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkDatabase } from "@coago/db";
import { liveSchema, readySchema, errorSchema } from "@coago/contracts";
export type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  ALLOWED_ORIGINS?: string;
};
export function createApp(
  check: (url: string) => Promise<void> = checkDatabase,
) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use(
    "*",
    cors({
      origin: (origin, c) =>
        (c.env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((s: string) => s.trim())
          .includes(origin)
          ? origin
          : undefined,
    }),
  );
  app.get("/health/live", (c) => c.json(liveSchema.parse({ status: "ok" })));
  app.get("/health/ready", async (c) => {
    const url =
      c.env.HYPERDRIVE?.connectionString ??
      (["local", "test"].includes(c.env.ENVIRONMENT ?? "")
        ? c.env.DATABASE_URL
        : undefined);
    try {
      if (!url) throw new Error("missing configuration");
      await check(url);
      return c.json(readySchema.parse({ status: "ready" }), 200);
    } catch {
      return c.json(readySchema.parse({ status: "unavailable" }), 503);
    }
  });
  app.notFound((c) => c.json(errorSchema.parse({ error: "not_found" }), 404));
  app.onError((_error, c) =>
    c.json(errorSchema.parse({ error: "internal_error" }), 500),
  );
  return app;
}
export default createApp();
