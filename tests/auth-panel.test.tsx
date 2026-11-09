import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import AuthPanel from "../apps/web/src/AuthPanel";
afterEach(() => vi.unstubAllGlobals());
it("shows real login link when anonymous and configured", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ user: null, csrfToken: null, loginAvailable: true }),
        ),
      ),
  );
  render(<AuthPanel />);
  expect(
    await screen.findByRole("link", { name: "เข้าสู่ระบบด้วย LINE" }),
  ).toHaveAttribute("href", "/api/auth/line/start");
});
it("shows authenticated user and sends CSRF-protected logout", async () => {
  const csrf = "a".repeat(64),
    request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: "123e4567-e89b-42d3-a456-426614174000",
              displayName: "ผู้ทดสอบ",
            },
            csrfToken: csrf,
            loginAvailable: true,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", request);
  render(<AuthPanel />);
  await screen.findByText("สวัสดี ผู้ทดสอบ");
  fireEvent.click(screen.getByRole("button", { name: "ออกจากระบบ" }));
  await screen.findByRole("link", { name: "เข้าสู่ระบบด้วย LINE" });
  expect(request.mock.calls[1][1].headers["X-CSRF-Token"]).toBe(csrf);
});
it("does not pretend login is available when session endpoint fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<AuthPanel />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
