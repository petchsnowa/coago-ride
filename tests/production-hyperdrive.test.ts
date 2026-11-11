import { beforeEach, expect, it, vi } from "vitest";
import { withDatabase } from "@coago/db";
import worker from "../scripts/production/hyperdrive-worker";
import {
  hyperdriveName,
  selectHyperdrive,
  verifyHyperdrive,
  probeName,
} from "../scripts/production/hyperdrive-policy";
vi.mock("@coago/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@coago/db")>()),
  withDatabase: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
const id = "a".repeat(32),
  origin = {
    scheme: "postgres" as const,
    host: "ep-example.neon.tech",
    port: 5432,
    database: "neondb",
    user: "fixture",
    password: "fixture-only",
  };
it("creates only when the dedicated name and pinned ID are absent", () => {
  expect(selectHyperdrive([], "")).toBeNull();
  expect(selectHyperdrive([{ id, name: hyperdriveName }], id)).toBe(id);
});
it.each([
  [[{ id, name: hyperdriveName }], ""],
  [[{ id, name: hyperdriveName }], "b".repeat(32)],
  [
    [
      { id, name: hyperdriveName },
      { id: "b".repeat(32), name: hyperdriveName },
    ],
    id,
  ],
  [[], id],
  [[], "invalid"],
] as const)(
  "never adopts an unpinned or ambiguous existing resource",
  (configs, pin) => expect(() => selectHyperdrive([...configs], pin)).toThrow(),
);
it("verifies exact production metadata and disabled query cache without comparing redacted passwords", () => {
  const config = {
    id,
    name: hyperdriveName,
    origin: { ...origin, password: "REDACTED" },
    caching: { disabled: true },
  };
  expect(() => verifyHyperdrive(config, origin, id)).not.toThrow();
  for (const changed of [
    { ...config, name: "coago-line-test" },
    { ...config, caching: { disabled: false } },
    { ...config, origin: { ...origin, host: "other.neon.tech" } },
  ])
    expect(() => verifyHyperdrive(changed, origin, id)).toThrow();
});
it("limits preview resource names to numeric run identities", () => {
  expect(probeName("123", "2")).toBe("coago-prod-probe-123-2");
  expect(() => probeName("production", "1")).toThrow();
});
const env = {
  PROBE_TOKEN: "fixture-only",
  HYPERDRIVE: { connectionString: "private-fixture-url" },
};
const request = () =>
  new Request("https://probe.example/", {
    headers: { Authorization: "Bearer fixture-only" },
  });
it.each([
  new Request("https://probe.example/"),
  new Request("https://probe.example/", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-only" },
  }),
  new Request("https://probe.example/other", {
    headers: { Authorization: "Bearer fixture-only" },
  }),
  new Request("https://probe.example/", {
    headers: { Authorization: "Bearer wrong" },
  }),
])(
  "blocks unauthorized, non-GET or unexpected path access before DB work",
  async (req) => {
    const response = await worker.fetch(req, env);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withDatabase).not.toHaveBeenCalled();
  },
);
it("fails closed without the Hyperdrive binding", async () =>
  expect(
    (await worker.fetch(request(), { PROBE_TOKEN: env.PROBE_TOKEN })).status,
  ).toBe(503));
it("returns only metadata/spatial proof using read-only schema queries", async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("transaction_read_only"))
      return {
        rows: [
          { readonly: "on", pg: "18.6", postgis: "3.6.4", app_tables: 10 },
        ],
      };
    if (sql.includes("to_regclass"))
      return { rows: [{ table_name: "drizzle.__drizzle_migrations" }] };
    if (sql.includes("count(*)::int AS count")) return { rows: [{ count: 9 }] };
    if (sql.includes("ST_AsText"))
      return { rows: [{ point: "POINT(100.5018 13.7563)", srid: 4326 }] };
    return { rows: [] };
  });
  vi.mocked(withDatabase).mockImplementation(async (_url, work) =>
    work({} as never, { query } as never),
  );
  const response = await worker.fetch(request(), env);
  expect(await response.json()).toEqual({
    transport: "hyperdrive",
    postgres: "18.6",
    postgis: "3.6.4",
    appTables: 10,
    migrations: 9,
    point: "POINT(100.5018 13.7563)",
    srid: 4326,
  });
  expect(query.mock.calls.map(([sql]) => sql.trim().split(/\s/)[0])).toEqual([
    "BEGIN",
    "SELECT",
    "SELECT",
    "SELECT",
    "ROLLBACK",
    "SELECT",
  ]);
});
it("does not expose database failure details", async () => {
  vi.mocked(withDatabase).mockRejectedValue(
    new Error("private connection details"),
  );
  const response = await worker.fetch(request(), env);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "PRODUCTION_HYPERDRIVE_UNAVAILABLE",
  });
});
