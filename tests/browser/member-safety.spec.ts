import { test, expect } from "@playwright/test";
const account = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Synthetic Member",
  },
  csrfToken: "a".repeat(64),
  loginAvailable: true,
};
test("member page refuses evidence until private storage is ready", async ({
  page,
}) => {
  await page.route("**/api/**", async (r) => {
    const p = new URL(r.request().url()).pathname;
    await r.fulfill({
      json:
        p === "/api/auth/me"
          ? account
          : p.endsWith("/status")
            ? { storageReady: false, profile: null }
            : p.endsWith("/vehicles")
              ? { vehicles: [] }
              : null,
    });
  });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "ข้อมูลสมาชิกและรถของฉัน" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("ยังไม่รับเอกสาร");
  await expect(
    page.getByRole("button", { name: "ส่งข้อมูลสมาชิกเพื่อตรวจสอบ" }),
  ).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Root Admin" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("staff email sign-in page never mixes LINE sign-in", async ({ page }) => {
  await page.route("**/api/admin-auth/**", (r) =>
    r.fulfill({
      json: r.request().url().endsWith("/config")
        ? { enabled: true }
        : { user: null, csrfToken: null, loginAvailable: true },
    }),
  );
  await page.goto("/root");
  await expect(page.getByLabel("อีเมล / ชื่อผู้ใช้")).toBeVisible();
  await expect(
    page.getByLabel("รหัสผ่าน (อย่างน้อย 12 ตัวอักษร)"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "เข้าสู่ระบบด้วย LINE" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "ตั้งบัญชีตามคำเชิญ" }),
  ).toBeVisible();
});
test("map route drives the fixed-share quote and a changed pin invalidates stale distance", async ({
  page,
}) => {
  await page.route("https://tile.openstreetmap.org/**", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/membership/**", (r) =>
    r.fulfill({
      json: r.request().url().endsWith("/vehicles")
        ? {
            vehicles: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                brand: "Toyota",
                model: "Yaris",
                color: "White",
                seats: 4,
                status: "approved",
                version: 2,
              },
            ],
          }
        : {
            distanceKm: 100,
            durationMinutes: 120,
            coordinates: [
              [100.5018, 13.7563],
              [102.835, 16.4419],
            ],
            source: "road",
          },
    }),
  );
  await page.goto("/tests/travel.html");
  await page
    .getByLabel("เลือกรถที่อนุมัติแล้ว")
    .selectOption("22222222-2222-4222-8222-222222222222");
  await page
    .getByRole("button", { name: "คำนวณระยะทางตามถนน", exact: true })
    .click();
  await expect(page.getByLabel("ผลคำนวณ")).toHaveText("20000");
  await page.getByLabel("จำนวนส่วนที่หาร รวมส่วนเจ้าของรถถ้ามี").fill("4");
  await expect(page.getByLabel("ผลคำนวณ")).toHaveText("10000");
  await expect(page.getByText(/ไม่เรียกเก็บเพิ่มภายหลัง/)).toBeVisible();
  await page
    .locator('[aria-label="แผนที่จุดรับและจุดส่ง"]')
    .click({ position: { x: 130, y: 170 } });
  await expect(page.getByLabel("ผลคำนวณ")).toHaveText("ยังไม่ครบ");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
