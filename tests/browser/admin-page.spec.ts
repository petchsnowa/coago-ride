import { test, expect } from "@playwright/test";
const account = {
  user: { id: "11111111-1111-4111-8111-111111111111", displayName: "Owner" },
  csrfToken: "a".repeat(64),
  loginAvailable: true,
};
test("dedicated admin page excludes passenger and driver tools", async ({
  page,
}) => {
  await page.route("**/api/**", async (r) => {
    const p = new URL(r.request().url()).pathname;
    await r.fulfill({
      json:
        p === "/api/auth/me"
          ? account
          : p === "/api/admin/me"
            ? { role: "root" }
            : p === "/api/admin/overview"
              ? {
                  users: 1,
                  suspended: 0,
                  active_trips: 0,
                  cancelled_trips: 0,
                  pending_requests: 0,
                  accepted_requests: 0,
                }
              : { items: [], nextCursor: null },
    });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Root Admin" })).toBeVisible();
  await expect(page.getByText("ผู้ใช้ทั้งหมด", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ไปหน้าผู้ใช้" }),
  ).toHaveAttribute("href", "/");
  await expect(
    page.getByText("บันทึกประกาศเที่ยว", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ตรวจสถานะระบบ" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("ordinary member receives no admin data", async ({ page }) => {
  let privateReads = 0;
  await page.route("**/api/**", async (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p.startsWith("/api/admin/") && p !== "/api/admin/me") privateReads++;
    await r.fulfill({
      json: p === "/api/auth/me" ? account : { role: "user" },
    });
  });
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("ไม่มีสิทธิ์");
  await expect(page.getByRole("heading", { name: "Root Admin" })).toHaveCount(
    0,
  );
  expect(privateReads).toBe(0);
});
