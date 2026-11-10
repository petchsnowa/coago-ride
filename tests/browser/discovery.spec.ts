import { test, expect, type Page } from "@playwright/test";
const id = "123e4567-e89b-42d3-a456-426614174001";
const trip = {
  id,
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "เชียงใหม่",
  departureAt: "2030-01-02T03:30:00.000Z",
  seats: 3,
  vehicleModel: "Toyota Corolla",
  vehicleColor: "ขาว",
  contributionSatang: 10025,
};
async function prepare(
  page: Page,
  mode: "success" | "empty" | "stale" | "error" | "pages" = "success",
) {
  let calls = 0;
  const queries: string[] = [];
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { user: null, csrfToken: null, loginAvailable: true } }),
  );
  await page.route("**/api/discovery/trips**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/${id}`)) {
      if (mode === "stale")
        return route.fulfill({
          status: 404,
          json: { error: "trip_not_found" },
        });
      return route.fulfill({
        json: {
          trip: {
            ...trip,
            pickupPoint: "สถานีต้นทาง",
            dropoffPoint: "สถานีปลายทาง",
            luggageNotes: "กระเป๋าเล็ก",
            conditions: "มาถึงก่อนเวลา 15 นาที",
          },
        },
      });
    }
    queries.push(url.search);
    calls++;
    if (mode === "error" && calls === 1)
      return route.fulfill({
        status: 503,
        json: { error: "service_unavailable" },
      });
    if (mode === "pages")
      return route.fulfill({
        json: {
          trips: url.searchParams.has("cursor")
            ? [
                {
                  ...trip,
                  id: "123e4567-e89b-42d3-a456-426614174002",
                  seats: 1,
                },
              ]
            : [trip],
          nextCursor: url.searchParams.has("cursor") ? null : "cursor-example",
        },
      });
    return route.fulfill({
      json: { trips: mode === "empty" ? [] : [trip], nextCursor: null },
    });
  });
  await page.goto("/");
  return { queries };
}
async function search(page: Page) {
  const form = page.getByRole("form", { name: "ค้นหาเที่ยวเดินทาง" });
  await form
    .getByRole("combobox", { name: "ต้นทางที่ต้องการ", exact: true })
    .selectOption("กรุงเทพมหานคร");
  await form
    .getByRole("combobox", { name: "ปลายทางที่ต้องการ", exact: true })
    .selectOption("เชียงใหม่");
  await form
    .getByLabel("วันเดินทาง (เวลาไทย)", { exact: true })
    .fill("2030-01-02");
  await form.getByRole("button", { name: "ค้นหาเที่ยว", exact: true }).click();
}
test.use({ timezoneId: "America/Los_Angeles" });
test("anonymous passenger searches and reads details in Thai time then closes with Escape", async ({
  page,
}) => {
  const state = await prepare(page);
  await search(page);
  await expect(page.locator(".search-card")).toHaveCount(1);
  await expect(page.locator(".search-card")).toContainText("10:30");
  await expect(page.locator(".search-card")).toContainText("100.25 บาท/คน");
  const params = new URLSearchParams(state.queries[0]);
  expect(params.get("date")).toBe("2030-01-02");
  expect(params.get("originProvince")).toBe("กรุงเทพมหานคร");
  await page.getByRole("button", { name: /^ดูรายละเอียดเที่ยว/ }).click();
  const dialog = page.getByRole("dialog", { name: "รายละเอียดเที่ยวเดินทาง" });
  await expect(dialog).toContainText("สถานีต้นทาง");
  await expect(dialog).toContainText("กระเป๋าเล็ก");
  await expect(dialog).toContainText("มาถึงก่อนเวลา 15 นาที");
  await expect(dialog.getByRole("button", { name: "แก้ไข" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /จอง/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /^ดูรายละเอียดเที่ยว/ }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("empty search explains no matching active trips", async ({ page }) => {
  await prepare(page, "empty");
  await search(page);
  await expect(
    page.getByText(/ไม่พบเที่ยวที่ยังเปิดประกาศสำหรับเส้นทางและวันที่นี้/),
  ).toBeVisible();
  await expect(page.locator(".search-card")).toHaveCount(0);
});
test("cancelled-between-results-and-detail shows unavailable and removes result", async ({
  page,
}) => {
  await prepare(page, "stale");
  await search(page);
  await page.getByRole("button", { name: /^ดูรายละเอียดเที่ยว/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "เที่ยวนี้ปิดประกาศหรือออกเดินทางแล้ว",
  );
  await page
    .getByRole("button", { name: "ปิดรายละเอียด", exact: true })
    .click();
  await expect(page.locator(".search-card")).toHaveCount(0);
});
test("search error retries original criteria", async ({ page }) => {
  const state = await prepare(page, "error");
  await search(page);
  await expect(page.getByRole("alert")).toContainText("ค้นหาไม่สำเร็จ");
  await page
    .getByRole("button", { name: "ลองค้นหาอีกครั้ง", exact: true })
    .click();
  await expect(page.locator(".search-card")).toHaveCount(1);
  expect(state.queries).toHaveLength(2);
  expect(state.queries[0]).toBe(state.queries[1]);
});
test("pagination uses submitted filters even if form is changed", async ({
  page,
}) => {
  const state = await prepare(page, "pages");
  await search(page);
  await expect(page.locator(".search-card")).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "ปลายทางที่ต้องการ", exact: true })
    .selectOption("ขอนแก่น");
  await page
    .getByRole("button", { name: "ดูเที่ยวเพิ่มเติม", exact: true })
    .click();
  await expect(page.locator(".search-card")).toHaveCount(2);
  expect(new URLSearchParams(state.queries[1]).get("destinationProvince")).toBe(
    "เชียงใหม่",
  );
  await expect(
    page.getByRole("button", { name: "ดูเที่ยวเพิ่มเติม" }),
  ).toHaveCount(0);
});
test("invalid route does not send a search request", async ({ page }) => {
  const state = await prepare(page);
  await page.getByRole("button", { name: "ค้นหาเที่ยว", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("กรุณาเลือกเส้นทาง");
  expect(state.queries).toHaveLength(0);
});

test("detail header and close button fit across responsive breakpoints", async ({
  page,
}) => {
  await prepare(page);
  await search(page);
  await page.getByRole("button", { name: /^ดูรายละเอียดเที่ยว/ }).click();
  const dialog = page.getByRole("dialog", { name: "รายละเอียดเที่ยวเดินทาง" });
  await expect(dialog).toContainText("สถานีต้นทาง");
  for (const width of [390, 640, 641, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await dialog.evaluate((element) => {
      const header = element.querySelector<HTMLElement>(".detail-header")!;
      const title = header.querySelector("h2")!.getBoundingClientRect();
      const close = header.querySelector("button")!.getBoundingClientRect();
      const bounds = header.getBoundingClientRect();
      return {
        fits: header.scrollWidth <= header.clientWidth + 1,
        titleWidth: title.width,
        inside:
          close.left >= bounds.left - 1 && close.right <= bounds.right + 1,
      };
    });
    expect(layout.fits, `header overflow at ${width}px`).toBe(true);
    expect(layout.inside, `close button outside header at ${width}px`).toBe(
      true,
    );
    expect(layout.titleWidth, `title compressed at ${width}px`).toBeGreaterThan(
      150,
    );
    if (width === 390 || width === 1440)
      await dialog.screenshot({
        path: test.info().outputPath(`detail-${width}.png`),
      });
  }
  await dialog
    .getByRole("button", { name: "ปิดรายละเอียด", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});
