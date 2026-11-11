import {
  Miniflare,
  Response as RuntimeResponse,
  Request as RuntimeRequest,
} from "miniflare";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { testDatabaseUrl } from "./database";
import { createApp } from "../apps/api/src/index";
import { postgresAuthStore } from "../apps/api/src/auth/store";
import { hash, randomToken } from "../apps/api/src/auth/crypto";
import { postgresTripStore } from "../apps/api/src/trips/store";
import { postgresRideRequestStore } from "../apps/api/src/requests/store";
import { postgresDiscoveryStore } from "../apps/api/src/discovery/store";
const base = testDatabaseUrl(),
  admin = new pg.Client({ connectionString: base }),
  name = `coago_member_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}_test`,
  url = new URL(base);
url.pathname = `/${name}`;
const client = new pg.Client({ connectionString: url.href }),
  originalFetch = globalThis.fetch;
let created = false;
const blobs = new Map<string, string>(),
  providerSessions = new Map<
    string,
    { email: string; id: string; emailVerified: boolean }
  >();
let verifyEmail = true;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const address = String(input);
  assert(address.startsWith("https://ep-fixture.neon.tech/neondb/auth"));
  if (address.endsWith("/sign-in/email")) {
    const data = JSON.parse(String(init?.body)),
      id = crypto.randomUUID(),
      token = randomToken();
    providerSessions.set(token, {
      email: data.email,
      id,
      emailVerified: verifyEmail,
    });
    return new Response(JSON.stringify({ user: { email: data.email } }), {
      headers: {
        "Set-Cookie": `__Secure-neon-auth.session_token=${token}; Path=/; Secure; HttpOnly`,
      },
    });
  }
  if (
    address.endsWith("/request-password-reset") ||
    address.endsWith("/email-otp/send-verification-otp")
  )
    return Response.json({ ok: true });
  if (address.endsWith("/reset-password"))
    return JSON.parse(String(init?.body)).token ===
      "fixture-reset-token-0123456789"
      ? Response.json({ ok: true })
      : Response.json({ error: "invalid" }, { status: 400 });
  if (address.endsWith("/email-otp/verify-email"))
    return JSON.parse(String(init?.body)).otp === "123456"
      ? Response.json({ ok: true })
      : Response.json({ error: "invalid" }, { status: 400 });
  if (address.endsWith("/sign-up/email"))
    return Response.json({ error: "already_exists" }, { status: 409 });
  if (address.endsWith("/get-session")) {
    const cookie = new Headers(init?.headers).get("Cookie")?.split("=")[1],
      user = providerSessions.get(cookie ?? "");
    return Response.json(
      user
        ? {
            user,
            session: {
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            },
          }
        : null,
    );
  }
  throw Error("UNEXPECTED_PROVIDER_REQUEST");
};
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await client.connect();
  await migrate(drizzle(client), {
    migrationsFolder: "packages/db/migrations",
  });
  const bindings = {
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://coago.space",
    LINE_CALLBACK_URL: "https://coago.space/api/auth/line/callback",
    LINE_CHANNEL_ID: "2009685358",
    LINE_CHANNEL_SECRET: "fixture-only",
    ROOT_ADMIN_EMAIL: "root@example.invalid",
    NEON_ADMIN_AUTH_URL: "https://ep-fixture.neon.tech/neondb/auth",
    MEMBER_DATA_KEY: Buffer.alloc(32, 7).toString("base64"),
    HYPERDRIVE: { connectionString: url.href },
    PRIVATE_DOCUMENTS: {
      async put(k: string, v: string) {
        blobs.set(k, v);
      },
      async get(k: string) {
        return blobs.has(k)
          ? {
              async text() {
                return blobs.get(k)!;
              },
            }
          : null;
      },
      async delete(k: string) {
        blobs.delete(k);
      },
    },
  };
  const app = createApp(),
    request = (
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
      csrf = "",
    ) =>
      app.request(
        `https://coago.space${path}`,
        {
          method,
          headers: {
            Origin: "https://coago.space",
            "Content-Type": "application/json",
            Cookie: cookie,
            "X-CSRF-Token": csrf,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        bindings,
      );
  assert.equal(
    (
      await request("/api/admin-auth/login", "POST", {
        email: "outsider@example.invalid",
        password: "fixture-passphrase",
      })
    ).status,
    401,
  );
  verifyEmail = false;
  assert.equal(
    (
      await request("/api/admin-auth/login", "POST", {
        email: bindings.ROOT_ADMIN_EMAIL,
        password: "fixture-passphrase",
      })
    ).status,
    401,
  );
  verifyEmail = true;
  const login = await request("/api/admin-auth/login", "POST", {
    email: bindings.ROOT_ADMIN_EMAIL,
    password: "fixture-passphrase",
  });
  assert.equal(login.status, 200);
  const staffCookie = login.headers.get("Set-Cookie")!.split(";")[0],
    staff = (await login.json()) as { user: { id: string }; csrfToken: string };
  assert.equal(
    (await request("/api/admin/overview", "GET", undefined, staffCookie))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/admin/overview",
        "GET",
        undefined,
        staffCookie.replace("coago_admin", "coago_session"),
      )
    ).status,
    401,
  );
  const auth = postgresAuthStore(url.href),
    userToken = randomToken(),
    userCsrf = randomToken(),
    now = new Date(),
    user = await auth.createSession(
      { subject: "U" + "b".repeat(32), displayName: "Synthetic Driver" },
      await hash(userToken),
      userCsrf,
      new Date(Date.now() + 3600000),
      now,
    ),
    userCookie = `__Host-coago_session=${userToken}`;
  const own = (p: string, m = "GET", b?: unknown) =>
      request(p, m, b, userCookie, userCsrf),
    staffCall = (p: string, m = "GET", b?: unknown) =>
      request(p, m, b, staffCookie, staff.csrfToken);
  assert.equal(
    (await request("/api/admin/overview", "GET", undefined, userCookie)).status,
    401,
  );
  const trips = postgresTripStore(url.href, true),
    draft = {
      originProvince: "กรุงเทพมหานคร" as const,
      destinationProvince: "ขอนแก่น" as const,
      departureAt: new Date(Date.now() + 86400000).toISOString(),
      pickupPoint: "Public station",
      dropoffPoint: "Public destination",
      seats: 1,
      vehicleModel: "Toyota Yaris",
      vehicleColor: "White",
      contributionSatang: 20000,
      luggageNotes: "",
      conditions: "",
    };
  await assert.rejects(
    trips.create(user.id, { ...draft, requestId: crypto.randomUUID() }, now),
    /member_verification_required/,
  );
  const ids: Record<string, string> = {};
  for (const purpose of ["portrait", "document", "vehicle", "plate"]) {
    const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
      r = await app.request(
        `https://coago.space/api/membership/uploads/${purpose}`,
        {
          method: "POST",
          headers: {
            Origin: bindings.APP_ORIGIN,
            Cookie: userCookie,
            "X-CSRF-Token": userCsrf,
            "X-Consent-Version": "2026-11-11",
            "Content-Type": "image/png",
          },
          body: bytes,
        },
        bindings,
      );
    assert.equal(r.status, 201);
    ids[purpose] = ((await r.json()) as { id: string }).id;
  }
  assert([...blobs.values()].every((v) => v.startsWith("v1.")));
  const profile = {
    fullName: "Synthetic Driver",
    phone: "0800000000",
    documentKind: "passport",
    documentNumber: "TEST1234",
    country: "TH",
    portraitId: ids.portrait,
    documentId: ids.document,
    consentVersion: "2026-11-11",
    version: 0,
  };
  assert.equal(
    (await own("/api/membership/profile", "PUT", profile)).status,
    200,
  );
  assert(
    !(
      await client.query("SELECT data FROM member_profiles")
    ).rows[0].data.includes(profile.documentNumber),
  );
  assert.equal(
    (await own(`/api/membership/review/profiles/${user.id}`)).status,
    401,
  );
  assert.equal(
    (await staffCall(`/api/membership/review/profiles/${user.id}`)).status,
    200,
  );
  assert.equal(
    (
      await staffCall(`/api/membership/review/profiles/${user.id}`, "PUT", {
        decision: "approved",
        version: 1,
        reason: "Fixture manual review",
      })
    ).status,
    200,
  );
  const vehicleId = crypto.randomUUID(),
    vehicle = {
      brand: "Toyota",
      model: "Yaris",
      color: "White",
      plate: "TEST 123",
      province: "กรุงเทพมหานคร",
      seats: 2,
      photoId: ids.vehicle,
      platePhotoId: ids.plate,
      version: 0,
    };
  assert.equal(
    (await own(`/api/membership/vehicles/${vehicleId}`, "PUT", vehicle)).status,
    200,
  );
  await assert.rejects(
    trips.create(user.id, { ...draft, requestId: crypto.randomUUID() }, now),
    /vehicle_and_route_required/,
  );
  assert.equal(
    (
      await staffCall(`/api/membership/review/vehicles/${vehicleId}`, "PUT", {
        decision: "approved",
        version: 1,
        reason: "Fixture car review",
      })
    ).status,
    200,
  );
  const safety = {
    vehicleId,
    vehicleVersion: 2,
    cost: {
      distanceKm: 100,
      fuelSatangPerKm: 300,
      operationsSatangPerKm: 100,
      extraSatang: 0,
      shares: 2,
    },
    origin: { lat: 13.7563, lng: 100.5018 },
    destination: { lat: 16.4419, lng: 102.835 },
    distanceSource: "manual" as const,
  };
  await assert.rejects(
    trips.create(
      user.id,
      { ...draft, safety, seats: 3, requestId: crypto.randomUUID() },
      now,
    ),
    /vehicle_capacity_exceeded/,
  );
  const trip = (
    await trips.create(
      user.id,
      { ...draft, safety, requestId: crypto.randomUUID() },
      now,
    )
  ).trip;
  assert.equal(trip.contributionSatang, 20000);
  assert.equal(
    (await own(`/api/membership/trip-photo/${trip.id}`)).status,
    200,
  );
  assert.equal(
    (await postgresDiscoveryStore(url.href, true).detail(trip.id, now))?.route
      ?.shares,
    2,
  );
  assert.equal(
    (
      await own(`/api/membership/vehicles/${vehicleId}`, "PUT", {
        ...vehicle,
        version: 2,
        color: "Blue",
      })
    ).status,
    200,
  );
  assert.equal(
    await postgresDiscoveryStore(url.href, true).detail(trip.id, now),
    undefined,
  );
  assert.equal((await trips.list(user.id)).trips[0].vehicleColor, "White");
  const passenger = await auth.createSession(
    { subject: "U" + "c".repeat(32), displayName: "Synthetic Passenger" },
    await hash(randomToken()),
    randomToken(),
    new Date(Date.now() + 3600000),
    now,
  );
  await assert.rejects(
    postgresRideRequestStore(url.href, true).create(
      passenger.id,
      { tripId: trip.id, requestId: crypto.randomUUID() },
      now,
    ),
    /member_verification_required/,
  );
  const outsiderToken = randomToken();
  await auth.createSession(
    { subject: "U" + "c".repeat(32), displayName: "Synthetic Passenger" },
    await hash(outsiderToken),
    randomToken(),
    new Date(Date.now() + 3600000),
    now,
  );
  assert.equal(
    (
      await request(
        `/api/membership/uploads/${ids.document}`,
        "GET",
        undefined,
        `__Host-coago_session=${outsiderToken}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await own("/api/membership/route", "POST", {
        origin: safety.origin,
        destination: safety.destination,
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await staffCall("/api/admin/accounts", "POST", {
        email: "moderator@example.invalid",
        name: "Moderator",
        reason: "Appoint",
      })
    ).status,
    201,
  );
  const moderatorLogin = await request("/api/admin-auth/login", "POST", {
    email: "moderator@example.invalid",
    password: "fixture-passphrase",
  });
  assert.equal(moderatorLogin.status, 200);
  const moderatorCookie = moderatorLogin.headers
    .get("Set-Cookie")!
    .split(";")[0];
  assert.deepEqual(
    await (
      await request("/api/admin/me", "GET", undefined, moderatorCookie)
    ).json(),
    { role: "admin" },
  );
  assert.equal(
    (await request("/api/admin/settings", "GET", undefined, moderatorCookie))
      .status,
    403,
  );
  const runtime = new Miniflare({
    modules: true,
    scriptPath: "apps/api/dist/index.js",
    compatibilityDate: "2026-07-08",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      ORS_API_KEY: "fixture-only",
      ...Object.fromEntries(
        Object.entries(bindings).filter(([key]) => key !== "PRIVATE_DOCUMENTS"),
      ),
    },
    r2Buckets: ["PRIVATE_DOCUMENTS"],
    outboundService: async (req: RuntimeRequest) => {
      if (req.url.startsWith("https://api.heigit.org/openrouteservice/"))
        return RuntimeResponse.json({
          features: [
            {
              geometry: {
                coordinates: [
                  [100.5018, 13.7563],
                  [102.835, 16.4419],
                ],
              },
              properties: { summary: { distance: 100000, duration: 7200 } },
            },
          ],
        });
      const r = await globalThis.fetch(req.url, {
        method: req.method,
        headers: Object.fromEntries(req.headers),
        ...(req.method === "POST" ? { body: await req.text() } : {}),
      });
      return new RuntimeResponse(await r.text(), {
        status: r.status,
        headers: Object.fromEntries(r.headers),
      });
    },
  });
  try {
    const runtimeLogin = await runtime.dispatchFetch(
      "https://coago.space/api/admin-auth/login",
      {
        method: "POST",
        headers: {
          Origin: bindings.APP_ORIGIN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: bindings.ROOT_ADMIN_EMAIL,
          password: "fixture-passphrase",
        }),
      },
    );
    assert.equal(runtimeLogin.status, 200);
    const runtimeStaff = (await runtimeLogin.json()) as { csrfToken: string };
    const runtimeStaffCookie = runtimeLogin.headers
      .get("Set-Cookie")!
      .split(";")[0];
    assert.equal(
      (
        await runtime.dispatchFetch("https://coago.space/api/admin/overview", {
          headers: { Cookie: runtimeStaffCookie },
        })
      ).status,
      200,
    );
    const quote = await runtime.dispatchFetch(
      "https://coago.space/api/membership/route",
      {
        method: "POST",
        headers: {
          Origin: bindings.APP_ORIGIN,
          Cookie: userCookie,
          "X-CSRF-Token": userCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          origin: safety.origin,
          destination: safety.destination,
        }),
      },
    );
    assert.equal(quote.status, 200);
    const roadQuote = (await quote.json()) as {
      routeProof: string;
      distanceKm: number;
    };
    assert.equal(roadQuote.distanceKm, 100);
    assert(roadQuote.routeProof);
    assert.equal(
      (
        await runtime.dispatchFetch(
          `https://coago.space/api/membership/review/vehicles/${vehicleId}`,
          {
            method: "PUT",
            headers: {
              Origin: bindings.APP_ORIGIN,
              Cookie: runtimeStaffCookie,
              "X-CSRF-Token": runtimeStaff.csrfToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              decision: "approved",
              version: 3,
              reason: "Recheck changed car",
            }),
          },
        )
      ).status,
      200,
    );
    const opened = await runtime.dispatchFetch(
      "https://coago.space/api/admin/settings",
      {
        method: "PUT",
        headers: {
          Origin: bindings.APP_ORIGIN,
          Cookie: runtimeStaffCookie,
          "X-CSRF-Token": runtimeStaff.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serviceOpen: true,
          registrationsOpen: false,
          version: 1,
          reason: "Disposable fixture only",
        }),
      },
    );
    assert.equal(opened.status, 200);
    const publish = await runtime.dispatchFetch(
      "https://coago.space/api/trips",
      {
        method: "POST",
        headers: {
          Origin: bindings.APP_ORIGIN,
          Cookie: userCookie,
          "X-CSRF-Token": userCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...draft,
          vehicleColor: "Blue",
          requestId: crypto.randomUUID(),
          safety: {
            ...safety,
            vehicleVersion: 4,
            distanceSource: "road",
            routeProof: roadQuote.routeProof,
          },
        }),
      },
    );
    assert.equal(publish.status, 201);
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await runtime.dispatchFetch(
      "https://coago.space/api/membership/uploads/portrait",
      {
        method: "POST",
        headers: {
          Origin: bindings.APP_ORIGIN,
          Cookie: userCookie,
          "X-CSRF-Token": userCsrf,
          "X-Consent-Version": "2026-11-11",
          "Content-Type": "image/png",
        },
        body: image,
      },
    );
    assert.equal(upload.status, 201);
    const uploadId = ((await upload.json()) as { id: string }).id;
    const read = await runtime.dispatchFetch(
      `https://coago.space/api/membership/uploads/${uploadId}`,
      { headers: { Cookie: userCookie } },
    );
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), image);
    assert.equal(
      (
        await runtime.dispatchFetch(
          `https://coago.space/api/membership/review-file/${uploadId}`,
          { headers: { Cookie: runtimeStaffCookie } },
        )
      ).status,
      200,
    );
  } finally {
    await runtime.dispose();
  }
  for (const [token, user] of providerSessions)
    if (user.email === "moderator@example.invalid")
      providerSessions.delete(token);
  assert.equal(
    (await request("/api/admin/overview", "GET", undefined, moderatorCookie))
      .status,
    401,
  );
  assert.equal((await staffCall("/api/admin/overview")).status, 200);
  assert.equal(
    (
      await request("/api/admin-auth/register", "POST", {
        email: bindings.ROOT_ADMIN_EMAIL,
        password: "fixture-passphrase",
        name: "Root",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/admin-auth/forgot", "POST", {
        email: bindings.ROOT_ADMIN_EMAIL,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/admin-auth/reset", "POST", {
        token: "fixture-reset-token-0123456789",
        newPassword: "fixture-new-passphrase",
      })
    ).status,
    200,
  );
  assert.equal((await staffCall("/api/admin/overview")).status, 401);
  providerSessions.clear();
  assert.equal(
    (await request("/api/admin/overview", "GET", undefined, moderatorCookie))
      .status,
    401,
  );
  assert(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM admin_audit WHERE action='private_document_viewed'",
      )
    ).rows[0].n >= 1,
  );
  console.log(
    "PASS safety/admin-email real DB/API + local Workers/R2 runtime with mocked Neon: separate staff cookie, verified email/root allowlist/invitation, live-provider session revocation, private encryption/ownership/audit, profile+vehicle approval/version/capacity gates, fixed quote, snapshot preservation and manual routing fallback",
  );
} finally {
  globalThis.fetch = originalFetch;
  await client.end().catch(() => {});
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
