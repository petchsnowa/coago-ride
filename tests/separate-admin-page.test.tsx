import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../apps/web/src/App";
const account = {
  user: { id: "11111111-1111-4111-8111-111111111111", displayName: "Owner" },
  csrfToken: "a".repeat(64),
  loginAvailable: true,
};
afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function mock(role = "root", loggedIn = true) {
  vi.stubEnv("VITE_APP_MODE", "production");
  const fetch = vi.fn(async (path: string) =>
    Response.json(
      path === "/api/admin-auth/config"
        ? { enabled: true }
        : path === "/api/auth/me" || path === "/api/admin-auth/me"
          ? loggedIn
            ? account
            : { user: null, csrfToken: null, loginAvailable: true }
          : path === "/api/admin/me"
            ? { role }
            : path === "/api/admin/overview"
              ? {
                  users: 1,
                  suspended: 0,
                  active_trips: 0,
                  cancelled_trips: 0,
                  pending_requests: 0,
                  accepted_requests: 0,
                }
              : path === "/api/site"
                ? { serviceOpen: false, registrationsOpen: false, version: 1 }
                : { trips: [], nextCursor: null },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("keeps the closed user homepage free of root controls even for the owner", async () => {
  const fetch = mock();
  render(<App />);
  await screen.findByText("สวัสดี Owner");
  expect(
    screen.getByRole("heading", { name: "กำลังเตรียมเปิดบริการ" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Root Admin")).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([p]) => p.startsWith("/api/admin/"))).toBe(
    false,
  );
});
it("shows only administration on /admin for the verified owner", async () => {
  window.history.replaceState({}, "", "/admin");
  mock();
  render(<App />);
  await screen.findByRole("heading", { name: "Root Admin" });
  await screen.findByText("ผู้ใช้ทั้งหมด");
  expect(screen.queryByText("ค้นหาเที่ยวเดินทาง")).not.toBeInTheDocument();
  expect(screen.queryByText("สถานะระบบ COAGO")).not.toBeInTheDocument();
  expect(screen.queryByText("บันทึกประกาศเที่ยว")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "ไปหน้าผู้ใช้" })).toHaveAttribute(
    "href",
    "/",
  );
});
it("denies ordinary users without requesting admin lists or overview", async () => {
  window.history.replaceState({}, "", "/admin/");
  const fetch = mock("user");
  render(<App />);
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("heading", { name: "Root Admin" }),
  ).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([p]) => p === "/api/admin/overview")).toBe(
    false,
  );
});
it("asks anonymous visitors to log in without fetching root data", async () => {
  window.history.replaceState({}, "", "/admin");
  const fetch = mock("user", false);
  render(<App />);
  await screen.findByRole("button", { name: "เข้าสู่ระบบ" });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(fetch.mock.calls.some(([p]) => p.startsWith("/api/admin/"))).toBe(
    false,
  );
});
