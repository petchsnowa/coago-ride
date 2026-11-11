import { test, expect } from "@playwright/test";
test("Root Admin tabs, required reason and layout on mobile and desktop", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111",
    target = "22222222-2222-4222-8222-222222222222";
  let mutations = 0;
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path.endsWith("/me")) data = { role: "root" };
    else if (path.endsWith("/overview"))
      data = {
        users: 2,
        suspended: 0,
        active_trips: 0,
        cancelled_trips: 0,
        pending_requests: 0,
        accepted_requests: 0,
      };
    else if (path.endsWith("/users"))
      data = {
        items: [
          {
            id,
            displayName: "เจ้าของระบบ",
            status: "active",
            version: 1,
            createdAt: "2026-11-11T00:00:00Z",
            isRoot: true,
          },
          {
            id: target,
            displayName: "สมาชิกทดสอบ",
            status: "active",
            version: 1,
            createdAt: "2026-11-11T00:00:00Z",
            isRoot: false,
          },
        ],
        nextCursor: null,
      };
    else if (path.endsWith("/status")) {
      mutations++;
      expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(64));
      expect(route.request().postDataJSON()).toEqual({
        status: "suspended",
        version: 1,
        reason: "ตรวจสอบรายการ",
      });
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/tests/admin.html");
  await expect(page.getByRole("heading", { name: "Root Admin" })).toBeVisible();
  await page.getByRole("button", { name: "ผู้ใช้", exact: true }).click();
  await expect(page.getByText("สมาชิกทดสอบ", { exact: true })).toBeVisible();
  expect(
    await page
      .getByRole("button", { name: "ระงับผู้ใช้", exact: true })
      .count(),
  ).toBe(1);
  await page.getByRole("button", { name: "ระงับผู้ใช้", exact: true }).click();
  const confirm = page.getByRole("button", { name: "ยืนยันและบันทึกประวัติ" });
  await expect(confirm).toBeDisabled();
  await page
    .getByRole("textbox", { name: "เหตุผลการจัดการ (จำเป็น)" })
    .fill("ตรวจสอบรายการ");
  await confirm.click();
  await expect.poll(() => mutations).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
