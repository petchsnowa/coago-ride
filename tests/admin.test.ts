import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/index";
import type { AuthStore } from "../apps/api/src/auth/store";
import { AdminError, type AdminStore } from "../apps/api/src/admin/store";
const rootId = "11111111-1111-4111-8111-111111111111",
  target = "22222222-2222-4222-8222-222222222222",
  csrf = "b".repeat(64),
  token = "a".repeat(64);
const settings = { serviceOpen: false, registrationsOpen: false, version: 1 };
const session = {
  user: { id: rootId, displayName: "Owner" },
  csrfToken: csrf,
  rootVerified: true,
};
const auth = { getSession: vi.fn(async () => session) } as unknown as AuthStore;
const admin = vi.fn(async () => false);
const role = vi.fn(async () => true),
  site = vi.fn(async () => settings);
const store: AdminStore = {
  setRole: vi.fn(async () => {}),
  overview: vi.fn(async () => ({
    users: 1,
    suspended: 0,
    active_trips: 0,
    cancelled_trips: 0,
    pending_requests: 0,
    accepted_requests: 0,
  })),
  list: vi.fn(async () => ({ items: [], nextCursor: null })),
  setUser: vi.fn(async () => {}),
  cancelTrip: vi.fn(async () => {}),
  settings: vi.fn(async () => settings),
  setSettings: vi.fn(async () => ({ ...settings, version: 2 })),
};
const bindings = {
  ENVIRONMENT: "production",
  APP_ORIGIN: "https://coago.space",
  LINE_CALLBACK_URL: "https://coago.space/api/auth/line/callback",
  LINE_CHANNEL_ID: "2009685358",
  LINE_CHANNEL_SECRET: "fixture-only",
  ROOT_ADMIN_LINE_SUBJECT: "U" + "a".repeat(32),
  HYPERDRIVE: { connectionString: "fixture" },
};
function app() {
  return createApp(
    undefined,
    { store: () => auth },
    {},
    {},
    {},
    { store: () => store, role, site, admin },
  );
}
function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app().request(
    `https://coago.space${path}`,
    {
      method,
      headers: {
        Cookie: `__Host-coago_session=${token}`,
        Origin: "https://coago.space",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  role.mockResolvedValue(true);
  admin.mockResolvedValue(false);
  vi.mocked(auth.getSession).mockResolvedValue(session);
});
it("denies anonymous admin access", async () => {
  expect(
    (await request("/api/admin/users", "GET", undefined, { Cookie: "" }))
      .status,
  ).toBe(401);
  expect(role).not.toHaveBeenCalled();
});
it("derives root permission from the verified session and server subject", async () => {
  const response = await request("/api/admin/me");
  expect(await response.json()).toEqual({ role: "root" });
  expect(role).toHaveBeenCalledWith(
    "fixture",
    rootId,
    bindings.ROOT_ADMIN_LINE_SUBJECT,
  );
});
it("normal users cannot elevate role through headers or request parameters", async () => {
  role.mockResolvedValue(false);
  expect(
    (
      await request("/api/admin/users?role=root", "GET", undefined, {
        "X-Role": "root",
      })
    ).status,
  ).toBe(403);
  expect(store.list).not.toHaveBeenCalled();
});
it.each<Record<string, string>>([
  { Origin: "https://evil.invalid" },
  { "X-CSRF-Token": "wrong" },
])("rejects unsafe admin mutations", async (headers) => {
  expect(
    (
      await request(
        `/api/admin/users/${target}/status`,
        "PUT",
        { status: "suspended", version: 1, reason: "policy" },
        headers,
      )
    ).status,
  ).toBe(403);
  expect(store.setUser).not.toHaveBeenCalled();
});
it.each([
  { status: "suspended", version: 1 },
  { status: "suspended", version: 0, reason: "policy" },
  { status: "suspended", version: 1, reason: "policy", actorId: target },
])("rejects incomplete or privileged-field input", async (body) =>
  expect(
    (await request(`/api/admin/users/${target}/status`, "PUT", body)).status,
  ).toBe(400),
);
it("passes the session actor to mutations, never an actor supplied by the browser", async () => {
  expect(
    (
      await request(`/api/admin/users/${target}/status`, "PUT", {
        status: "suspended",
        version: 1,
        reason: "policy",
      })
    ).status,
  ).toBe(200);
  expect(store.setUser).toHaveBeenCalledWith(
    rootId,
    target,
    { status: "suspended", version: 1, reason: "policy" },
    expect.any(Date),
  );
});
it("validates pagination and body size before store access", async () => {
  expect((await request("/api/admin/audit?cursor=!!")).status).toBe(400);
  expect(
    (
      await request("/api/admin/settings", "PUT", {
        ...settings,
        reason: "a".repeat(5000),
      })
    ).status,
  ).toBe(413);
  expect(store.list).not.toHaveBeenCalled();
  expect(store.setSettings).not.toHaveBeenCalled();
});
it("protects root accounts and reports conflict without leaking internals", async () => {
  vi.mocked(store.setUser).mockRejectedValueOnce(
    new AdminError("root_protected"),
  );
  const r = await request(`/api/admin/users/${rootId}/status`, "PUT", {
    status: "suspended",
    version: 1,
    reason: "policy",
  });
  expect(r.status).toBe(409);
  expect(await r.json()).toEqual({ error: "root_protected" });
});
it("hides public trips while service is closed and blocks non-root business access", async () => {
  role.mockResolvedValue(false);
  const r = await request("/api/discovery/trips/upcoming");
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: "service_closed" });
  expect(r.headers.get("cache-control")).toBe("no-store");
});
it("does not apply maintenance restrictions to root administration", async () => {
  const r = await request("/api/admin/overview");
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ users: 1 });
  expect(r.headers.get("cache-control")).toBe("no-store");
});
it("publishes only site flags and version without root identity", async () =>
  expect(await (await request("/api/site")).json()).toEqual(settings));
it("blocks preview admin sessions before any auth lookup", async () => {
  const r = await app().request(
    "https://preview.workers.dev/api/admin/me",
    { headers: { Cookie: `__Host-coago_session=${token}` } },
    bindings,
  );
  expect(r.status).toBe(401);
  expect(auth.getSession).not.toHaveBeenCalled();
});

it("requires a freshly verified root session even when identity matches", async () => {
  vi.mocked(auth.getSession).mockResolvedValueOnce({
    ...session,
    rootVerified: false,
  });
  expect((await request("/api/admin/users")).status).toBe(403);
  expect(store.list).not.toHaveBeenCalled();
});

it("allows admin moderation but denies role and site settings APIs", async () => {
  role.mockResolvedValue(false);
  admin.mockResolvedValue(true);
  expect(await (await request("/api/admin/me")).json()).toEqual({
    role: "admin",
  });
  expect((await request("/api/admin/users")).status).toBe(200);
  expect((await request("/api/admin/settings")).status).toBe(403);
  expect(
    (
      await request(`/api/admin/users/${target}/role`, "PUT", {
        role: "admin",
        version: 1,
        reason: "Escalate",
      })
    ).status,
  ).toBe(403);
  expect(store.setRole).not.toHaveBeenCalled();
});
it("root can grant admin with version/reason and session-derived actor", async () => {
  expect(
    (
      await request(`/api/admin/users/${target}/role`, "PUT", {
        role: "admin",
        version: 1,
        reason: "Appoint",
      })
    ).status,
  ).toBe(200);
  expect(store.setRole).toHaveBeenCalledWith(
    rootId,
    target,
    { role: "admin", version: 1, reason: "Appoint" },
    expect.any(Date),
  );
  expect(
    (
      await request(`/api/admin/users/${target}/role`, "PUT", {
        role: "root",
        version: 1,
        reason: "Escalate",
      })
    ).status,
  ).toBe(400);
});
