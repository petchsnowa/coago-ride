import { test, expect } from "@playwright/test";
const tripId = "22222222-2222-4222-8222-222222222222",
  postId = "33333333-3333-4333-8333-333333333333";
test("approved passenger creates and cancels a wanted post without personal information", async ({
  page,
}) => {
  let posts: Record<string, unknown>[] = [],
    saves = 0,
    cancels = 0;
  await page.route("**/api/**", async (r) => {
    const p = new URL(r.request().url()).pathname,
      method = r.request().method();
    let data: unknown;
    if (p === "/api/membership/status")
      data = { profile: { status: "approved" } };
    else if (p === "/api/notifications")
      data = { enabled: false, available: false, consentVersion: "2026-11-12" };
    else if (p === "/api/wanted" && method === "POST") {
      saves++;
      const input = r.request().postDataJSON();
      expect(r.request().headers()["x-csrf-token"]).toBe("a".repeat(64));
      posts = [
        {
          ...input,
          id: postId,
          version: 1,
          status: "active",
          cancellationReason: null,
          createdAt: "2030-01-01T00:00:00Z",
          updatedAt: "2030-01-01T00:00:00Z",
        },
      ];
      delete posts[0].requestId;
      data = { post: posts[0] };
    } else if (p.endsWith("/cancel")) {
      cancels++;
      data = {
        post: {
          ...posts[0],
          status: "cancelled",
          version: 2,
          cancellationReason: "พบเที่ยวแล้ว",
        },
      };
      posts = [];
    } else if (p === "/api/wanted/mine") data = { posts, nextCursor: null };
    else if (p === "/api/discovery/wanted")
      data = {
        posts: posts.map((p) =>
          Object.fromEntries(
            Object.entries(p).filter(([k]) =>
              [
                "id",
                "originProvince",
                "destinationProvince",
                "departureFrom",
                "departureUntil",
                "seats",
                "budgetSatang",
              ].includes(k),
            ),
          ),
        ),
        nextCursor: null,
      };
    else data = { error: "not_found" };
    await r.fulfill({ json: data });
  });
  await page.goto("/tests/community.html");
  await page.getByLabel("ต้นทางที่ต้องการหารถ").selectOption("กรุงเทพมหานคร");
  await page.getByLabel("ปลายทางที่ต้องการหารถ").selectOption("ขอนแก่น");
  await page.getByLabel("เดินทางได้ตั้งแต่").fill("2030-01-01T10:00");
  await page
    .getByLabel("ถึงเวลา (ช่วงไม่เกิน24ชั่วโมง)")
    .fill("2030-01-01T12:00");
  await page.getByLabel("งบต่อคนไม่เกิน (บาท ไม่บังคับ)").fill("300.25");
  await page.getByRole("button", { name: "เผยแพร่ประกาศหารถ" }).click();
  await expect(
    page.getByText("บันทึกประกาศหารถแล้ว ยังไม่ใช่การจองที่นั่ง"),
  ).toBeVisible();
  expect(saves).toBe(1);
  expect(posts[0].budgetSatang).toBe(30025);
  await page
    .getByRole("button", { name: "ยกเลิกประกาศหารถ", exact: true })
    .click();
  await page.getByLabel("เหตุผลยกเลิกประกาศหารถ").fill("พบเที่ยวแล้ว");
  await page.getByRole("button", { name: "ยืนยันยกเลิกประกาศหารถ" }).click();
  await expect(page.getByText("ยกเลิกประกาศหารถแล้ว")).toBeVisible();
  expect(cancels).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("driver updates text status, reads route only on demand and keeps incidents in the current stage", async ({
  page,
}) => {
  let state = {
    tripId,
    status: "not_started",
    issue: false,
    version: 0,
    updatedAt: null as string | null,
    canUpdate: true,
    driverEligible: true,
    trip: {
      status: "active",
      originProvince: "กรุงเทพมหานคร",
      destinationProvince: "ขอนแก่น",
      departureAt: "2030-01-01T03:00:00Z",
      pickupPoint: "สถานีต้นทาง",
      dropoffPoint: "สถานีปลายทาง",
      route: null,
    },
    events: [] as Record<string, unknown>[],
  };
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === `/api/journeys/${tripId}`) {
      if (r.request().method() === "POST") {
        const input = r.request().postDataJSON();
        expect(input).not.toHaveProperty("lat");
        state = {
          ...state,
          status: input.status,
          issue: input.issue,
          version: state.version + 1,
          updatedAt: "2030-01-01T02:00:00Z",
          events: [
            {
              id: crypto.randomUUID(),
              status: input.status,
              issue: input.issue,
              note: input.note,
              createdAt: "2030-01-01T02:00:00Z",
            },
            ...state.events,
          ],
        };
      }
      await r.fulfill({ json: state });
    } else
      await r.fulfill({
        json:
          path === "/api/membership/status"
            ? { profile: null }
            : path === "/api/notifications"
              ? {
                  enabled: false,
                  available: false,
                  consentVersion: "2026-11-12",
                }
              : { posts: [], nextCursor: null },
      });
  });
  await page.goto("/tests/community.html");
  await page.getByRole("button", { name: "ดูสถานะการเดินทาง" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("ยังไม่มีการรายงาน", { exact: false }),
  ).toBeVisible();
  await expect(dialog.locator(".leaflet-container")).toHaveCount(0);
  await dialog.getByRole("button", { name: "บันทึกสถานะการเดินทาง" }).click();
  await expect(dialog.getByText("บันทึกสถานะการเดินทางแล้ว")).toBeVisible();
  expect(state.status).toBe("ready");
  await dialog.getByLabel("มีเหตุขัดข้องที่ต้องแจ้งผู้ร่วมทาง").check();
  await dialog
    .getByLabel("รายละเอียดเพิ่มเติมสำหรับผู้ร่วมทางและผู้ดูแล")
    .fill("รออยู่บริเวณจุดนัดหมาย");
  await dialog.getByRole("button", { name: "บันทึกสถานะการเดินทาง" }).click();
  expect(state.status).toBe("ready");
  await expect(dialog.getByLabel("อัปเดตขั้นตอน")).toBeDisabled();
  await dialog.getByText("ดูแผนที่จุดรับ–ส่ง", { exact: true }).click();
  await expect(dialog.getByText("เที่ยวนี้ยังไม่ได้บันทึกพิกัด")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
test("LINE preferences require configuration and explicit consent; palette has readable dashboard text", async ({
  page,
}) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json: (() => {
        const path = new URL(r.request().url()).pathname;
        if (path === "/api/notifications")
          return {
            enabled: false,
            available: false,
            consentVersion: "2026-11-12",
          };
        if (path === "/api/auth/me")
          return { user: null, csrfToken: null, loginAvailable: true };
        if (path.endsWith("/activity"))
          return {
            updatedAt: "2030-01-01T00:00:00Z",
            totals: {
              trips: 0,
              vehicles: 0,
              seats: 0,
              pendingRequests: 0,
              wantedPosts: 0,
            },
            destinations: [],
            wantedDestinations: [],
          };
        if (path.endsWith("/upcoming")) return { trips: [], nextCursor: null };
        return { posts: [], nextCursor: null };
      })(),
    }),
  );
  await page.goto("/tests/community.html");
  await expect(
    page.getByLabel("ยินยอมรับการแจ้งเตือนผ่าน LINE (ปิดได้ทุกเมื่อ)"),
  ).toBeDisabled();
  await expect(
    page.getByText("ระบบยังไม่เปิดส่งข้อความ", { exact: false }),
  ).toBeVisible();
  await page.goto("/");
  const tile = page.locator(".dashboard-tile").first();
  await expect(tile).toBeVisible();
  expect(await tile.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    "rgb(141, 182, 0)",
  );
  expect(await tile.evaluate((e) => getComputedStyle(e).color)).toBe(
    "rgb(17, 17, 17)",
  );
  await page.screenshot({
    path: test.info().outputPath("coago-theme.png"),
    fullPage: true,
  });
  expect(
    await page
      .locator("body")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe("rgb(253, 252, 248)");
});
