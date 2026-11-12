import { test, expect } from "@playwright/test";
const anon = { user: null, csrfToken: null, loginAvailable: true };
const account = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "สมาชิกทดสอบ",
  },
  csrfToken: "a".repeat(64),
  loginAvailable: true,
};
test("home has six readable shortcuts without displaying staff controls", async ({
  page,
}) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json:
        new URL(r.request().url()).pathname === "/api/auth/me"
          ? anon
          : { trips: [], nextCursor: null },
    }),
  );
  await page.goto("/");
  await expect(
    page
      .getByRole("navigation", { name: "ทางลัดการใช้บริการ" })
      .getByRole("link"),
  ).toHaveCount(6);
  await expect(
    page.getByRole("navigation", { name: "เมนูหลักด้านล่าง" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Root COAGO" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: test.info().outputPath("dashboard.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("location denial prevents request POST and a later permission grant allows it", async ({
  page,
  context,
}) => {
  let posts = 0;
  await page.route("**/api/**", async (r) => {
    if (r.request().method() === "POST") {
      posts++;
      return r.fulfill({ status: 503, json: { error: "service_unavailable" } });
    }
    await r.fulfill({
      json: r.request().url().includes("for-trip")
        ? { canRequest: true, isOwner: false, request: null }
        : { member: null, vehicle: null },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
          fail({ code: 1 }),
      },
    });
  });
  await page.goto("/tests/dashboard.html");
  await page
    .getByRole("button", { name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "เปิดใช้ตำแหน่งก่อนส่งคำขอ",
  );
  expect(posts).toBe(0);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 13.7563, longitude: 100.5018 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: Object.getOwnPropertyDescriptor(
        Navigator.prototype,
        "geolocation",
      )!.get!.call(navigator),
    });
  });
  await page
    .getByRole("button", { name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง", exact: true })
    .click();
  await expect.poll(() => posts).toBe(1);
});
test("member and staff fields stack cleanly without horizontal overflow", async ({
  page,
}) => {
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      json: path.endsWith("/config")
        ? { enabled: true }
        : path.includes("admin-auth")
          ? anon
          : path === "/api/auth/me"
            ? account
            : path.endsWith("/status")
              ? { storageReady: false, profile: null }
              : path.endsWith("/vehicles")
                ? { vehicles: [] }
                : null,
    });
  });
  for (const path of ["/root", "/account"]) {
    await page.goto(path);
    await expect(
      page.locator('input:not([type="checkbox"])').first(),
    ).toBeVisible();
    const fields = await page
      .locator('input:not([type="checkbox"]):not([type="file"])')
      .evaluateAll((inputs) =>
        inputs.map((input) => {
          const r = input.getBoundingClientRect();
          return { width: r.width, height: r.height, right: r.right };
        }),
      );
    await page.screenshot({
      path: test
        .info()
        .outputPath(path === "/root" ? "root-form.png" : "member-form.png"),
      fullPage: true,
    });
    expect(fields.every((r) => r.width >= 120 && r.height >= 44)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("dashboard shortcuts open header tools and duplicate lower cards are gone", async ({
  page,
}) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json: r.request().url().endsWith("/api/auth/me")
        ? anon
        : { trips: [], nextCursor: null },
    }),
  );
  await page.route("**/health/ready", (r) =>
    r.fulfill({ json: { status: "ready" } }),
  );
  await page.goto("/");
  await expect(page.locator(".home-previews, .bottom-menu")).toHaveCount(0);
  await page.getByRole("link", { name: /^ตั้งค่าตำแหน่ง เปิดตำแหน่ง/ }).click();
  await expect(
    page.getByRole("heading", { name: "เปิดตำแหน่งก่อนใช้บริการ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เปิดใช้ตำแหน่ง", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "เปิดตำแหน่งก่อนใช้บริการ" }),
  ).not.toBeVisible();
  await page.getByRole("link", { name: /^การเดินทางของฉัน ดูเที่ยว/ }).click();
  await expect(
    page.getByRole("link", { name: "เข้าสู่ระบบด้วย LINE", exact: true }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "สถานะระบบ" }).click();
  await page
    .getByRole("button", { name: "ตรวจสถานะระบบ", exact: true })
    .click();
  await expect(
    page.getByText("ระบบพร้อมสำหรับการพัฒนาต่อ", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("top-menu.png"),
    fullPage: true,
  });
});

test("public activity uses real aggregate totals and opens the next trip for a destination", async ({
  page,
}) => {
  const id = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      json:
        path === "/api/auth/me"
          ? anon
          : path.endsWith("/activity")
            ? {
                updatedAt: "2030-01-01T03:00:00.000Z",
                totals: { vehicles: 2, trips: 3, seats: 7, pendingRequests: 2 },
                destinations: [
                  {
                    province: "เชียงใหม่",
                    vehicles: 2,
                    trips: 3,
                    seats: 7,
                    pendingRequests: 2,
                    nextTripId: id,
                    nextDepartureAt: "2030-01-02T03:00:00.000Z",
                  },
                ],
              }
            : path.endsWith(id)
              ? {
                  trip: {
                    id,
                    originProvince: "กรุงเทพมหานคร",
                    destinationProvince: "เชียงใหม่",
                    departureAt: "2030-01-02T03:00:00.000Z",
                    seats: 3,
                    vehicleModel: "Fixture car",
                    vehicleColor: "White",
                    contributionSatang: 10000,
                    pickupPoint: "Station A",
                    dropoffPoint: "Station B",
                    luggageNotes: "",
                    conditions: "",
                  },
                }
              : { trips: [], nextCursor: null },
    });
  });
  await page.goto("/");
  const board = page.getByRole("region", { name: "ภาพรวมการร่วมเดินทาง" });
  await expect(board).toContainText("3 เที่ยว · 2 คัน · ว่าง 7 ที่นั่ง");
  await expect(board).toContainText("คำขอรอร่วมทางไปเชียงใหม่ 2 คำขอ");
  await page.screenshot({
    path: test.info().outputPath("travel-activity.png"),
    fullPage: true,
  });
  await board
    .getByRole("button", { name: "ดูเที่ยวถัดไปเชียงใหม่", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Station A");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("activity errors show retry rather than fabricated zero counts", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    return p.endsWith("/activity")
      ? r.fulfill({
          status: failed ? 503 : 200,
          json: failed
            ? { error: "service_unavailable" }
            : {
                updatedAt: new Date().toISOString(),
                totals: { trips: 0, vehicles: 0, seats: 0, pendingRequests: 0 },
                destinations: [],
              },
        })
      : r.fulfill({
          json: p === "/api/auth/me" ? anon : { trips: [], nextCursor: null },
        });
  });
  await page.goto("/");
  const board = page.getByRole("region", { name: "ภาพรวมการร่วมเดินทาง" });
  await expect(board).toContainText("ยังโหลดภาพรวมไม่ได้");
  await expect(board.locator(".activity-totals")).toHaveCount(0);
  failed = false;
  await board
    .getByRole("button", { name: "อัปเดตภาพรวม", exact: true })
    .click();
  await expect(board).toContainText("ยังไม่มีเที่ยวเปิดรับในขณะนี้");
});
