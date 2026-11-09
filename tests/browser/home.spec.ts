import { test, expect } from "@playwright/test";
test("home and readiness interaction", async ({ page }) => {
  await page.route("**/health/ready", (route) =>
    route.fulfill({ json: { status: "ready" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "ต่างจังหวัด",
  );
  await page.getByRole("button", { name: "ตรวจสถานะระบบ" }).click();
  await expect(page.getByRole("status")).toContainText("ระบบพร้อม");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
