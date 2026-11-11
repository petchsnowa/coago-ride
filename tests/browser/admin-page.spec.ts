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
test("Root appoints admin and admin has no role/settings controls", async ({
  page,
}) => {
  const target = "22222222-2222-4222-8222-222222222222";
  let role = "root",
    granted = false;
  await page.route("**/api/**", async (r) => {
    const p = new URL(r.request().url()).pathname;
    let data: unknown = {};
    if (p === "/api/auth/me") data = account;
    else if (p === "/api/admin/me") data = { role };
    else if (p === "/api/admin/overview")
      data = {
        users: 2,
        suspended: 0,
        active_trips: 0,
        cancelled_trips: 0,
        pending_requests: 0,
        accepted_requests: 0,
      };
    else if (p === "/api/admin/users")
      data = {
        items: [
          {
            id: target,
            displayName: "Moderator",
            status: "active",
            version: granted ? 2 : 1,
            role: granted ? "admin" : "user",
            createdAt: "2026-11-11T00:00:00Z",
            isRoot: false,
          },
        ],
        nextCursor: null,
      };
    else if (p.endsWith("/role")) {
      expect(r.request().headers()["x-csrf-token"]).toBe("a".repeat(64));
      expect(r.request().postDataJSON()).toEqual({
        role: "admin",
        version: 1,
        reason: "แต่งตั้งผู้ดูแล",
      });
      granted = true;
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "ผู้ใช้", exact: true }).click();
  await page
    .getByRole("button", { name: "แต่งตั้ง Admin", exact: true })
    .click();
  const confirm = page.getByRole("button", { name: "ยืนยันและบันทึกประวัติ" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("textbox").fill("แต่งตั้งผู้ดูแล");
  await confirm.click();
  await expect(
    page.getByRole("button", { name: "ถอนสิทธิ์ Admin", exact: true }),
  ).toBeVisible();
  role = "admin";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Admin", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เปิด–ปิดบริการ", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "ผู้ใช้", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Moderator/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ถอนสิทธิ์ Admin", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "ระงับผู้ใช้", exact: true }),
  ).toHaveCount(0);
});
