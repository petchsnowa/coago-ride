import { test, expect } from "@playwright/test";
test("home and readiness interaction", async ({ page }) => {
  await page.route("**/health/ready", (route) =>
    route.fulfill({ json: { status: "ready" } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { user: null, csrfToken: null, loginAvailable: true },
    }),
  );
  await page.route("**/api/discovery/trips/upcoming", (r) =>
    r.fulfill({ json: { trips: [], nextCursor: null } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "วันนี้จะไปที่ไหน",
  );
  const toggle = page.getByRole("button", { name: /^เมนู/ });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator("summary").filter({ hasText: "สถานะระบบ" }).click();
  await page.getByRole("button", { name: "ตรวจสถานะระบบ" }).click();
  await expect(
    page
      .getByRole("region", { name: "เรากำลังเตรียม COAGO ให้พร้อม" })
      .getByRole("status"),
  ).toContainText("ระบบพร้อม");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
