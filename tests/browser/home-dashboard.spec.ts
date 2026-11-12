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
    page
      .getByRole("navigation", { name: "เมนูหลักด้านล่าง" })
      .getByRole("link"),
  ).toHaveCount(4);
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
