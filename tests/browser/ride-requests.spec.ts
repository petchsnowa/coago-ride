import { test, expect, type Page } from "@playwright/test";
const tripId = "123e4567-e89b-42d3-a456-426614174001",
  id = "123e4567-e89b-42d3-a456-426614174002",
  csrf = "b".repeat(64);
const trip = {
  id: tripId,
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "เชียงใหม่",
  departureAt: "2030-01-02T03:30:00.000Z",
  seats: 3,
  vehicleModel: "Test car",
  vehicleColor: "ขาว",
  contributionSatang: 10025,
};
const fixture = {
  id,
  status: "pending" as "pending" | "cancelled",
  seatsRequested: 1,
  passengerName: "Passenger tester",
  tripChanged: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  trip: { ...trip, status: "active" },
};
async function prepare(
  page: Page,
  options: { owner?: boolean; drop?: boolean } = {},
) {
  let request: typeof fixture | null = options.owner ? { ...fixture } : null,
    dropped = false;
  const keys: string[] = [];
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "123e4567-e89b-42d3-a456-426614174000",
          displayName: options.owner ? "Driver tester" : "Passenger tester",
        },
        csrfToken: csrf,
        loginAvailable: true,
      },
    }),
  );
  await page.route("**/api/auth/logout", (r) => r.fulfill({ status: 204 }));
  await page.route("**/api/trips/mine", (r) =>
    r.fulfill({ json: { trips: [], nextCursor: null } }),
  );
  await page.route("**/api/discovery/trips**", (r) =>
    r.fulfill({
      json: r.request().url().includes(`/trips/${tripId}`)
        ? {
            trip: {
              ...trip,
              pickupPoint: "Station A",
              dropoffPoint: "Station B",
              luggageNotes: "",
              conditions: "",
            },
          }
        : { trips: [trip], nextCursor: null },
    }),
  );
  await page.route("**/api/ride-requests**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() === "GET") {
      if (path.includes("/for-trip/"))
        return r.fulfill({
          json: {
            isOwner: !!options.owner,
            canRequest: !options.owner && request?.status !== "pending",
            request: options.owner ? null : request,
          },
        });
      const show = path.endsWith(options.owner ? "/incoming" : "/mine");
      return r.fulfill({
        json: { requests: show && request ? [request] : [], nextCursor: null },
      });
    }
    expect(r.request().headers()["x-csrf-token"]).toBe(csrf);
    if (path.endsWith("/cancel")) {
      request = { ...fixture, status: "cancelled" };
      return r.fulfill({ json: { request } });
    }
    const body = r.request().postDataJSON();
    expect(body.tripId).toBe(tripId);
    expect(body.seatsRequested).toBeUndefined();
    keys.push(body.requestId);
    request = { ...fixture };
    if (options.drop && !dropped) {
      dropped = true;
      return r.abort();
    }
    return r.fulfill({
      status: keys.length === 1 ? 201 : 200,
      json: { request },
    });
  });
  await page.goto("/");
  await expect(
    page
      .getByText("สวัสดี Passenger tester", { exact: true })
      .or(page.getByText("สวัสดี Driver tester", { exact: true })),
  ).toBeVisible();
  await page
    .locator(".upcoming-card")
    .getByRole("button", { name: /^ดูรายละเอียดเที่ยว/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Station A");
  return { keys };
}
test("passenger requests one seat, sees pending after reload, cancels and logs out", async ({
  page,
}) => {
  await prepare(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("ชื่อแสดงของคุณจะให้เจ้าของเที่ยวเห็น");
  await dialog
    .getByRole("button", { name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง", exact: true })
    .click();
  await expect(dialog).toContainText("ส่งคำขอ 1 ที่นั่งแล้ว");
  await expect(
    dialog.getByRole("button", {
      name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "ปิดรายละเอียด", exact: true })
    .click();
  await expect(page.locator(".ride-request-card")).toContainText("รอตอบรับ");
  await page.reload();
  await expect(page.locator(".ride-request-card")).toHaveCount(1);
  await page.getByRole("button", { name: "ยกเลิกคำขอ", exact: true }).click();
  await page
    .getByRole("button", { name: "ยืนยันยกเลิกคำขอ", exact: true })
    .click();
  await expect(page.locator(".ride-request-card")).toContainText(
    "ยกเลิกคำขอแล้ว",
  );
  await page
    .getByRole("region", { name: "คำขอร่วมเดินทาง", exact: true })
    .screenshot({ path: test.info().outputPath("request-list.png") });
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(page.locator(".ride-request-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "คำขอร่วมเดินทาง", exact: true }),
  ).toHaveCount(0);
});
test("lost create response retries the same key", async ({ page }) => {
  const state = await prepare(page, { drop: true });
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง", exact: true })
    .click();
  await expect(dialog).toContainText("ส่งคำขอ 1 ที่นั่งแล้ว");
  expect(state.keys).toHaveLength(2);
  expect(state.keys[0]).toBe(state.keys[1]);
});
test("driver cannot request own trip and can read incoming name only in private panel", async ({
  page,
}) => {
  await prepare(page, { owner: true });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("คุณเป็นเจ้าของเที่ยวนี้");
  await expect(
    dialog.getByRole("button", {
      name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "ปิดรายละเอียด", exact: true })
    .click();
  await page
    .getByRole("button", { name: "คำขอที่เข้ามา", exact: true })
    .click();
  await expect(page.locator(".ride-request-card")).toContainText(
    "Passenger tester",
  );
  await expect(
    page.getByRole("button", { name: "ยกเลิกคำขอ", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("trip closing during submission disables another request", async ({
  page,
}) => {
  await prepare(page);
  await page.route("**/api/ride-requests", (r) =>
    r.fulfill({ status: 409, json: { error: "trip_unavailable" } }),
  );
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง", exact: true })
    .click();
  await expect(dialog).toContainText("เที่ยวนี้ไม่เปิดรับคำขอแล้ว");
  await expect(
    dialog.getByRole("button", {
      name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("replayed pending request on a cancelled trip never claims it is waiting for acceptance", async ({
  page,
}) => {
  await prepare(page);
  await page.route("**/api/ride-requests", (r) =>
    r.fulfill({
      status: 200,
      json: {
        request: { ...fixture, trip: { ...fixture.trip, status: "cancelled" } },
      },
    }),
  );
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "ส่งคำขอร่วมเดินทาง 1 ที่นั่ง", exact: true })
    .click();
  await expect(dialog.locator(".request-status")).toHaveText(
    "เที่ยวยกเลิกแล้ว",
  );
  await expect(dialog).toContainText(
    "คำขอยังอยู่ในประวัติ แต่เที่ยวไม่พร้อมให้ร่วมเดินทางแล้ว",
  );
});
