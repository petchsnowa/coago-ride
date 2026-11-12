import { test, expect, type Page } from "@playwright/test";
test.use({ timezoneId: "America/Los_Angeles" });
const csrf = "b".repeat(64),
  userId = "123e4567-e89b-42d3-a456-426614174000";
async function prepare(page: Page, dropFirstResponse = false) {
  let trips: Record<string, unknown>[] = [],
    first = true;
  const requests: string[] = [];
  await page.route("**/api/ride-requests/**", (r) =>
    r.fulfill({ json: { requests: [], nextCursor: null } }),
  );
  await page.route("**/api/discovery/trips/upcoming", (r) =>
    r.fulfill({ json: { trips: [], nextCursor: null } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: { id: userId, displayName: "Trip tester" },
        csrfToken: csrf,
        loginAvailable: true,
      },
    }),
  );

  await page.route("**/api/trips**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === "GET") {
      await route.fulfill({
        json: {
          trips: trips.map((t) => {
            const { requestId: ignored, ...dto } = t;
            void ignored;
            return dto;
          }),
          nextCursor: null,
        },
      });
      return;
    }
    expect(request.headers()["x-csrf-token"]).toBe(csrf);
    const body = request.postDataJSON();
    if (request.method() === "POST" && url.pathname === "/api/trips") {
      requests.push(body.requestId);
      if (!trips.some((t) => t.requestId === body.requestId)) {
        const { requestId, ...fields } = body;
        const trip: Record<string, unknown> = {
          ...fields,
          id: "123e4567-e89b-42d3-a456-426614174001",
          version: 1,
          status: "active",
          cancellationReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          requestId,
        };
        trips = [trip];
      }
      if (dropFirstResponse && first) {
        first = false;
        await route.abort();
        return;
      }
    } else if (request.method() === "PUT")
      trips = trips.map((t) => ({
        ...t,
        ...body,
        version: Number(t.version) + 1,
      }));
    else
      trips = trips.map((t) => ({
        ...t,
        status: "cancelled",
        cancellationReason: body.reason,
        version: Number(t.version) + 1,
      }));
    const { requestId: ignored, ...dto } = trips[0];
    void ignored;
    await route.fulfill({
      status:
        request.method() === "POST" &&
        url.pathname === "/api/trips" &&
        requests.length === 1
          ? 201
          : 200,
      json: { trip: dto },
    });
  });
  await page.goto("/");
  await page
    .getByRole("heading", { name: "เที่ยวเดินทางของฉัน", exact: true })
    .waitFor();
  return { requests, getTrips: () => trips };
}
async function fill(page: Page) {
  await page
    .getByRole("combobox", { name: "จังหวัดต้นทาง", exact: true })
    .selectOption("กรุงเทพมหานคร");
  await page
    .getByRole("combobox", { name: "จังหวัดปลายทาง", exact: true })
    .selectOption("เชียงใหม่");
  await page.getByLabel("วันเวลาออกเดินทาง (เวลาไทย)").fill("2030-01-02T10:30");
  await page.getByLabel("ที่นั่งว่างที่เปิดรับ (1–8 ที่นั่ง)").fill("3");
  await page.getByLabel("จุดนัดรับ", { exact: true }).fill("สถานีต้นทาง");
  await page.getByLabel("จุดส่ง", { exact: true }).fill("สถานีปลายทาง");
  await page
    .getByLabel("ยี่ห้อและรุ่นรถ", { exact: true })
    .fill("Toyota Corolla");
  await page.getByLabel("สีรถ", { exact: true }).fill("ขาว");
  await page.getByLabel("เงินร่วมค่าเดินทาง (บาทต่อคน)").fill("100.25");
}
test("owner creates, edits and cancels an announcement on mobile/desktop", async ({
  page,
}) => {
  const state = await prepare(page);
  await fill(page);
  await page
    .getByRole("button", { name: "บันทึกประกาศเที่ยว", exact: true })
    .click();
  await expect(page.locator(".trip-card")).toHaveCount(1);
  expect(state.getTrips()[0].departureAt).toBe("2030-01-02T03:30:00.000Z");
  expect(state.getTrips()[0].contributionSatang).toBe(10025);
  await page.getByRole("button", { name: /^แก้ไขเที่ยว/ }).click();
  await expect(page.getByLabel("วันเวลาออกเดินทาง (เวลาไทย)")).toHaveValue(
    "2030-01-02T10:30",
  );
  await page.getByLabel("ที่นั่งว่างที่เปิดรับ (1–8 ที่นั่ง)").fill("2");
  await page
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(page.locator(".trip-card")).toContainText("2 ที่นั่ง");
  await page.getByRole("button", { name: /^ยกเลิกเที่ยว/ }).click();
  await page
    .getByLabel("เหตุผลยกเลิก", { exact: true })
    .fill("เปลี่ยนแผนเดินทาง");
  await page
    .getByRole("button", { name: "ยืนยันยกเลิกเที่ยว", exact: true })
    .click();
  await expect(page.locator(".trip-card")).toContainText("ยกเลิกแล้ว");
  await expect(page.locator(".trip-card")).toContainText("เปลี่ยนแผนเดินทาง");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("retry after lost response reuses the creation key and does not duplicate", async ({
  page,
}) => {
  const state = await prepare(page, true);
  await fill(page);
  await page
    .getByRole("button", { name: "บันทึกประกาศเที่ยว", exact: true })
    .click();
  await expect(page.locator(".trip-alert")).toBeVisible();
  await page
    .getByRole("button", { name: "บันทึกประกาศเที่ยว", exact: true })
    .click();
  await expect(page.locator(".trip-card")).toHaveCount(1);
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0]).toBe(state.requests[1]);
  expect(state.getTrips()).toHaveLength(1);
});
test("invalid input stays on form and does not send an announcement", async ({
  page,
}) => {
  const state = await prepare(page);
  await page
    .getByRole("button", { name: "บันทึกประกาศเที่ยว", exact: true })
    .click();
  await expect(page.locator(".trip-alert")).toContainText("กรุณาตรวจข้อมูล");
  expect(state.requests).toHaveLength(0);
});

test("logout clears the private trip list and form", async ({ page }) => {
  await prepare(page);
  await fill(page);
  await page
    .getByRole("button", { name: "บันทึกประกาศเที่ยว", exact: true })
    .click();
  await expect(page.locator(".trip-card")).toHaveCount(1);
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
  const toggle = page.getByRole("button", { name: /^เมนู/ });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator("summary").filter({ hasText: "บัญชีของฉัน" }).click();
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(page.locator(".trip-card")).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "ประกาศเที่ยวใหม่" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "เข้าสู่ระบบด้วย LINE", exact: true }),
  ).toBeVisible();
});

test("stale update shows a conflict and requires explicit reload", async ({
  page,
}) => {
  await prepare(page);
  await fill(page);
  await page
    .getByRole("button", { name: "บันทึกประกาศเที่ยว", exact: true })
    .click();
  await expect(page.locator(".trip-card")).toHaveCount(1);
  await page.getByRole("button", { name: /^แก้ไขเที่ยว/ }).click();
  await page.getByLabel("ที่นั่งว่างที่เปิดรับ (1–8 ที่นั่ง)").fill("2");
  await page.route("**/api/trips/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 409, json: { error: "trip_conflict" } })
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "บันทึกการแก้ไข", exact: true })
    .click();
  await expect(page.locator(".trip-alert")).toContainText("ถูกแก้ไขแล้ว");
  await expect(
    page.getByLabel("ที่นั่งว่างที่เปิดรับ (1–8 ที่นั่ง)"),
  ).toHaveValue("2");
  await page
    .getByRole("button", { name: "ยกเลิกการแก้ไขและโหลดใหม่", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ประกาศเที่ยวใหม่", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trip-card")).toContainText("3 ที่นั่ง");
});
